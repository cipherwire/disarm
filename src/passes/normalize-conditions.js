import traverseModule from '@babel/traverse';
import * as t from '@babel/types';

const traverse = traverseModule.default ?? traverseModule;

function isLiteralNode(node) {
  if (!node) return false;
  return (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    (t.isIdentifier(node) && (node.name === 'undefined' || node.name === 'NaN' || node.name === 'Infinity'))
  );
}

const flippedOperators = {
  '===': '===',
  '!==': '!==',
  '==': '==',
  '!=': '!=',
  '<': '>',
  '<=': '>=',
  '>': '<',
  '>=': '<=',
};

/**
 * Normalize inverted "Yoda conditions" by placing identifiers and expressions on the left
 * and literals on the right.
 *
 * Obfuscators invert binary comparisons to break signatures:
 *   "hidden" === document.visibilityState -> document.visibilityState === "hidden"
 *   402 === status -> status === 402
 *   null !== token -> token !== null
 *   0 < count -> count > 0
 *
 * This pass normalizes comparisons to standard developer convention.
 */
export const normalizeConditions = {
  name: 'normalize-conditions',
  description: 'Normalize Yoda conditions by flipping literals to the right-hand side.',
  run(ast, report) {
    let normalized = 0;

    traverse(ast, {
      BinaryExpression(path) {
        const { operator, left, right } = path.node;
        const newOp = flippedOperators[operator];
        if (!newOp) return;

        // If left is a literal and right is not, flip them
        if (isLiteralNode(left) && !isLiteralNode(right)) {
          path.replaceWith(
            t.binaryExpression(
              newOp,
              t.cloneNode(right, true),
              t.cloneNode(left, true),
            ),
          );
          normalized++;
        }
      },
    });

    report.count(normalized);
    if (normalized > 0) {
      report.note(`normalized ${normalized} Yoda condition(s)`);
    }
  },
};
