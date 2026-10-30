import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
import { literalValueOf, literalNode } from '../utils/ast.js';

const traverse = traverseModule.default ?? traverseModule;

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

    traverse(ast, {
      BinaryExpression: {
        exit(path) {
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

              if (
                leftVal.ok &&
                rightVal.ok &&
                typeof leftVal.value !== 'symbol' &&
                typeof rightVal.value !== 'symbol'
              ) {
                const combined = String(leftVal.value) + String(rightVal.value);
                path.replaceWith(t.stringLiteral(combined));
                totalChanges++;
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
                totalChanges++;
              }
            }
          }
        },
      },
    });

    report.count(totalChanges);
    if (totalChanges > 0) {
      report.note(`fused ${totalChanges} split string and literal expression(s)`);
    }
  },
};
