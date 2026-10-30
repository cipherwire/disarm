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

const MAX_ROUNDS = 25;

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

    // Collapse literal chains upward in the same visit. Babel traverses
    // top-down, so a left-deep chain like 1+2+3+...+N or !0+!0+!0 would
    // otherwise need one full round per level (and huge bundles blow the
    // round cap with warnings).
    const climbBinary = (path) => {
      let p = path.parentPath;
      while (p && p.isBinaryExpression() && PURE_BINARY[p.node.operator]) {
        const l = literalValueOf(p, p.node.left);
        const r = literalValueOf(p, p.node.right);
        if (!l.ok || !r.ok) break;
        const v = PURE_BINARY[p.node.operator](l.value, r.value);
        if (typeof v === 'number' && v < 0) break;
        const lit = literalNode(v);
        if (!lit) break;
        p.replaceWith(lit);
        roundChanges++;
        p = p.parentPath;
      }
    };
    const climbLogical = (path) => {
      let p = path.parentPath;
      while (p && p.isLogicalExpression() && (p.node.operator === '&&' || p.node.operator === '||')) {
        const l = literalValueOf(p, p.node.left);
        if (!l.ok) break;
        if (p.node.operator === '&&' && !l.value) {
          const n = literalNode(l.value);
          if (!n) break;
          p.replaceWith(n);
        } else if (p.node.operator === '&&') {
          p.replaceWith(p.node.right);
        } else if (l.value) {
          const n = literalNode(l.value);
          if (!n) break;
          p.replaceWith(n);
        } else {
          p.replaceWith(p.node.right);
        }
        roundChanges++;
        p = p.parentPath;
      }
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
            if (!tryFold(op(left.value, right.value), path)) return;
            climbBinary(path);
          },
          UnaryExpression(path) {
            const { operator } = path.node;
            if (
              operator === '-' &&
              (t.isNumericLiteral(path.node.argument) ||
                (t.isIdentifier(path.node.argument) && path.node.argument.name === 'Infinity'))
            ) {
              return;
            }
            const operand = literalValueOf(path, path.node.argument);
            if (!operand.ok) return;
            const value = operand.value;
            let folded = false;
            if (operator === '!') folded = tryFold(!value, path);
            else if (operator === 'typeof') folded = tryFold(typeof value, path);
            else if (operator === '-' && (typeof value === 'number' || typeof value === 'boolean')) {
              folded = tryFold(-value, path);
            } else if (operator === '+' && (typeof value === 'number' || typeof value === 'boolean' || value === null)) {
              folded = tryFold(+value, path);
            } else if (operator === '~' && typeof value === 'number') {
              folded = tryFold(~value, path);
            }
            if (folded) climbBinary(path);
          },
          LogicalExpression(path) {
            const left = literalValueOf(path, path.node.left);
            if (!left.ok) return;
            const { operator, right } = path.node;
            let handled = false;
            if (operator === '&&') {
              if (!left.value) tryFold(left.value, path);
              else {
                path.replaceWith(right);
                roundChanges++;
              }
              handled = true;
            } else if (operator === '||') {
              if (left.value) tryFold(left.value, path);
              else {
                path.replaceWith(right);
                roundChanges++;
              }
              handled = true;
            } else if (operator === '??') {
              if (left.value != null) tryFold(left.value, path);
              else {
                path.replaceWith(right);
                roundChanges++;
              }
              handled = true;
            }
            if (handled) {
              climbBinary(path);
              climbLogical(path);
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
      // Still converging at the cap is normal on huge bundles  -  the pipeline
      // runs fold-constants again later, so this is progress information,
      // not a failure signal. A stuck (non-converging) count would be a bug.
      report.note(
        `fold-constants paused at the ${MAX_ROUNDS}-round cap with ${roundChanges} cascades still open; the later pipeline run continues folding`,
      );
    }
    report.count(total);
  },
};
