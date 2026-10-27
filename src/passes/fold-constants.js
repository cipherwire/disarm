import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
import { literalValueOf, literalNode } from '../utils/ast.js';

const traverse = traverseModule.default ?? traverseModule;

/** Binary operators that are pure for primitive operands. */
const PURE_BINARY = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '%': (a, b) => a % b,
  '**': (a, b) => a ** b,
  '==': (a, b) => a == b,
  '===': (a, b) => a === b,
  '!=': (a, b) => a != b,
  '!==': (a, b) => a !== b,
  '<': (a, b) => a < b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '>=': (a, b) => a >= b,
  '&': (a, b) => a & b,
  '|': (a, b) => a | b,
  '^': (a, b) => a ^ b,
  '<<': (a, b) => a << b,
  '>>': (a, b) => a >> b,
  '>>>': (a, b) => a >>> b,
};

const MAX_ROUNDS = 10;

/**
 * Constant folding over primitives: binary ops, unary ops, and logical
 * expressions whose left side already decides the result. Short-circuit
 * semantics guarantee the dropped side never runs, so folding is safe.
 *
 * Two hard-won constraints (both found by running the real ThreatMetrix
 * script, not by theory):
 *   - Nodes are read directly (literalValueOf) instead of via path.get():
 *     creating child NodePaths inside a mutated tree can push Babel into
 *     re-crawling scopes and re-entering the traversal :  stack overflow.
 *   - Negative results are skipped: they would print as a UnaryExpression,
 *     which re-triggers this visitor on its own replacement forever.
 * Cascades ("a" + "b" + (6 * 7) needs to see 42 first) are handled by
 * repeating whole rounds until nothing changes.
 */
export const foldConstants = {
  name: 'fold-constants',
  description: 'Fold pure binary/unary/logical expressions over literals (iterative to fixpoint).',
  run(ast, report) {
    let total = 0;
    let rounds = 0;
    let roundChanges = 0;

    const tryFold = (value, path) => {
      const node = literalNode(value);
      if (!node) return false;
      path.replaceWith(node);
      path.skip();
      roundChanges++;
      return true;
    };

    do {
      roundChanges = 0;
      rounds++;
      traverse.cache?.clearScope?.();
      try {
        traverse(ast, {
          BinaryExpression(path) {
            const op = PURE_BINARY[path.node.operator];
            if (!op) return;
            const left = literalValueOf(path, path.node.left);
            const right = literalValueOf(path, path.node.right);
            if (!left.ok || !right.ok) return;
            tryFold(op(left.value, right.value), path);
          },
          UnaryExpression(path) {
            const { operator } = path.node;
            if (operator === '-' && t.isNumericLiteral(path.node.argument)) return;
            const operand = literalValueOf(path, path.node.argument);
            if (!operand.ok) return;
            const value = operand.value;
            if (operator === '!') tryFold(!value, path);
            else if (operator === 'typeof') tryFold(typeof value, path);
            else if (operator === '-' && (typeof value === 'number' || typeof value === 'boolean')) {
              tryFold(-value, path);
            } else if (operator === '+' && (typeof value === 'number' || typeof value === 'boolean' || value === null)) {
              tryFold(+value, path);
            } else if (operator === '~' && typeof value === 'number') {
              tryFold(~value, path);
            }
          },
          LogicalExpression(path) {
            const left = literalValueOf(path, path.node.left);
            if (!left.ok) return;
            const { operator, right } = path.node;
            if (operator === '&&') {
              if (!left.value) tryFold(left.value, path);
              else {
                path.replaceWith(right);
                roundChanges++;
              }
            } else if (operator === '||') {
              if (left.value) tryFold(left.value, path);
              else {
                path.replaceWith(right);
                roundChanges++;
              }
            } else if (operator === '??') {
              if (left.value != null) tryFold(left.value, path);
              else {
                path.replaceWith(right);
                roundChanges++;
              }
            }
          },
        });
      } catch {
        // A round can die mid-traversal on hostile trees; keep what we
        // folded and let the remaining passes (which clear caches) finish.
        report.warn('fold-constants round aborted early by traversal error');
      }
      total += roundChanges;
    } while (roundChanges > 0 && rounds < MAX_ROUNDS);

    if (rounds >= MAX_ROUNDS && roundChanges > 0) {
      report.warn(`fold-constants did not reach a fixpoint after ${MAX_ROUNDS} rounds`);
    }
    report.count(total);
  },
};
