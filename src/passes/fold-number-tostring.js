import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
import { literalValueOf, hasLocalBinding } from '../utils/ast.js';

const traverse = traverseModule.default ?? traverseModule;

/**
 * Fold `Number(343388).toString(25)` and friends into the resulting string.
 * Obfuscators hide event names and keywords behind radix conversions; the
 * values are pure so folding them is always safe.
 */
export const foldNumberToString = {
  name: 'fold-number-tostring',
  description: 'Fold Number(n).toString(radix) and n.toString(radix) into string literals.',
  run(ast, report) {
    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;
        if (!t.isMemberExpression(callee)) return;
        const propName = !callee.computed && t.isIdentifier(callee.property)
          ? callee.property.name
          : callee.computed && t.isStringLiteral(callee.property)
            ? callee.property.value
            : null;
        if (propName !== 'toString') return;

        let number;
        const numVal = literalValueOf(path, callee.object);
        if (numVal.ok && typeof numVal.value === 'number') {
          number = numVal.value;
        } else if (
          t.isCallExpression(callee.object) &&
          t.isIdentifier(callee.object.callee) &&
          callee.object.callee.name === 'Number' &&
          callee.object.arguments.length === 1 &&
          !hasLocalBinding(path, 'Number')
        ) {
          const innerVal = literalValueOf(path, callee.object.arguments[0]);
          if (innerVal.ok && typeof innerVal.value === 'number') {
            number = innerVal.value;
          } else {
            return;
          }
        } else {
          return;
        }

        let radix = 10;
        if (path.node.arguments.length === 1) {
          const radixVal = literalValueOf(path, path.node.arguments[0]);
          if (!radixVal.ok || typeof radixVal.value !== 'number') return;
          radix = radixVal.value;
        } else if (path.node.arguments.length !== 0) {
          return;
        }
        if (!Number.isInteger(radix) || radix < 2 || radix > 36) return;
        if (!Number.isFinite(number)) return;

        path.replaceWith(t.stringLiteral(number.toString(radix)));
        report.count();
      },
    });
  },
};
