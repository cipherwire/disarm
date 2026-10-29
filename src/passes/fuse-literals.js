import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
import { literalValueOf, literalNode } from '../utils/ast.js';

const traverse = traverseModule.default ?? traverseModule;

/** After folding a node, fold its parent chain while it stays literal
 * (left-deep chains otherwise need one round per level). */
function climbLiteralChain(path) {
  let p = path.parentPath;
  while (p && p.isBinaryExpression() && PURE_OPERATORS[p.node.operator]) {
    const left = literalValueOf(p, p.node.left);
    const right = literalValueOf(p, p.node.right);
    if (!left.ok || !right.ok) break;
    if (p.node.operator === '+') {
      // '+' only becomes string concatenation when a string operand is
      // involved  -  two numbers must add numerically.
      const isString = t.isStringLiteral(p.node.left) || t.isStringLiteral(p.node.right);
      if (isString) {
        p.replaceWith(t.stringLiteral(String(left.value) + String(right.value)));
      } else if (typeof left.value === 'number' && typeof right.value === 'number') {
        const sum = left.value + right.value;
        if (!Number.isFinite(sum)) break;
        p.replaceWith(literalNode(sum));
      } else break;
    } else {
      if (typeof left.value !== 'number' || typeof right.value !== 'number') break;
      const value = PURE_OPERATORS[p.node.operator](left.value, right.value);
      if (value === null || Number.isNaN(value) || !Number.isFinite(value)) break;
      p.replaceWith(literalNode(value));
    }
    p = p.parentPath;
  }
}

const PURE_OPERATORS = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => (b !== 0 ? a / b : null),
  '%': (a, b) => (b !== 0 ? a % b : null),
  '^': (a, b) => a ^ b,
  '&': (a, b) => a & b,
  '|': (a, b) => a | b,
  '<<': (a, b) => a << b,
  '>>': (a, b) => a >> b,
};

/**
 * Fuse split string literals and compile-time arithmetic trees into canonical literals.
 * Inverts splitStrings and number-to-expression obfuscation patterns early in the pipeline.
 */
export const fuseLiterals = {
  name: 'fuse-literals',
  description: 'Fuse adjacent split string literals and pure constant arithmetic expressions.',
  run(ast, report) {
    let totalChanges = 0;
    let roundChanges = 0;
    let round = 0;

    do {
      roundChanges = 0;
      round++;
      traverse.cache?.clearScope?.();

      traverse(ast, {
      BinaryExpression(path) {
        const { operator, left, right } = path.node;
        const fn = PURE_OPERATORS[operator];
        if (!fn) return;

        // String concatenation specialization
        if (operator === '+') {
          const isLeftString = t.isStringLiteral(left);
          const isRightString = t.isStringLiteral(right);

          if (isLeftString || isRightString) {
            const leftVal = literalValueOf(path, left);
            const rightVal = literalValueOf(path, right);

            if (leftVal.ok && rightVal.ok && typeof leftVal.value !== 'symbol' && typeof rightVal.value !== 'symbol') {
              const combined = String(leftVal.value) + String(rightVal.value);
              path.replaceWith(t.stringLiteral(combined));
              path.skip();
              roundChanges++;
              totalChanges++;
              climbLiteralChain(path);
              return;
            }
          }
        }

        // Numeric and bitwise literal folding
        const leftVal = literalValueOf(path, left);
        const rightVal = literalValueOf(path, right);
        if (!leftVal.ok || !rightVal.ok) return;

        if (typeof leftVal.value === 'number' && typeof rightVal.value === 'number') {
          const res = fn(leftVal.value, rightVal.value);
          if (res !== null && !Number.isNaN(res) && Number.isFinite(res)) {
            const replacement = literalNode(res);
            if (replacement) {
              path.replaceWith(replacement);
              path.skip();
              roundChanges++;
              totalChanges++;
              climbLiteralChain(path);
            }
          }
        }
      },
    });
    } while (roundChanges > 0 && round < 5);

    report.count(totalChanges);
    if (totalChanges > 0) {
      report.note(`fused ${totalChanges} split string and literal expression(s)`);
    }
  },
};
