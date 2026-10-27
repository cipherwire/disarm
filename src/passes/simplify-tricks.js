import traverseModule from '@babel/traverse';
import * as t from '@babel/types';

const traverse = traverseModule.default ?? traverseModule;

/**
 * Rewrite the coercion tricks obfuscators lean on into plain literals:
 *   ![]    -> false
 *   +[]    -> 0
 *   void 0 -> undefined
 *   [][[]] -> undefined
 */
export const simplifyTricks = {
  name: 'simplify-tricks',
  description: 'Fold coercion tricks (![], +[], !0, !1, void 0, [][[]]) into plain literals.',
  run(ast, report) {
    traverse(ast, {
      UnaryExpression(path) {
        const { operator, argument } = path.node;
        if (operator === '!' && t.isNumericLiteral(argument)) {
          if (argument.value === 0) {
            path.replaceWith(t.booleanLiteral(true));
            report.count();
            return;
          }
          if (argument.value === 1) {
            path.replaceWith(t.booleanLiteral(false));
            report.count();
            return;
          }
        }
        if (t.isArrayExpression(argument) && argument.elements.length === 0) {
          if (operator === '!') {
            path.replaceWith(t.booleanLiteral(false));
            report.count();
            return;
          }
          if (operator === '+') {
            path.replaceWith(t.numericLiteral(0));
            report.count();
            return;
          }
        }
        if (
          operator === 'void' &&
          (t.isStringLiteral(argument) || t.isNumericLiteral(argument) ||
            t.isBooleanLiteral(argument) || t.isNullLiteral(argument))
        ) {
          path.replaceWith(t.identifier('undefined'));
          report.count();
        }
      },
      BinaryExpression(path) {
        const { operator, left, right } = path.node;
        if (
          operator === '+' &&
          t.isArrayExpression(left) && left.elements.length === 0 &&
          t.isArrayExpression(right) && right.elements.length === 0
        ) {
          path.replaceWith(t.stringLiteral(''));
          report.count();
        }
      },
      MemberExpression(path) {
        const node = path.node;
        // `[][[]]`: the property is an array literal whose elements are all
        // empty arrays (`[]` or `[[]]`), so it string-coerces to "" and the
        // lookup on an empty array is always undefined.
        const propertyIsBlank =
          t.isArrayExpression(node.property) &&
          node.property.elements.every(
            (element) => t.isArrayExpression(element) && element.elements.length === 0,
          );
        if (
          node.computed &&
          t.isArrayExpression(node.object) && node.object.elements.length === 0 &&
          propertyIsBlank
        ) {
          path.replaceWith(t.identifier('undefined'));
          report.count();
        }
      },
    });
  },
};
