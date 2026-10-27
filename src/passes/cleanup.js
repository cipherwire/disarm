import traverseModule from '@babel/traverse';
import * as t from '@babel/types';

const traverse = traverseModule.default ?? traverseModule;

/** Final sweep: drop empty statements and leftover pure-literal statements. */
export const cleanup = {
  name: 'cleanup',
  description: 'Remove empty statements and leftover pure-literal statements.',
  run(ast, report) {
    traverse(ast, {
      EmptyStatement(path) {
        path.remove();
        report.count();
      },
      ExpressionStatement(path) {
        const expression = path.node.expression;
        if (
          t.isStringLiteral(expression) ||
          t.isNumericLiteral(expression) ||
          t.isBooleanLiteral(expression) ||
          t.isNullLiteral(expression) ||
          (t.isIdentifier(expression) &&
            (expression.name === 'undefined' || expression.name === 'NaN' || expression.name === 'Infinity'))
        ) {
          path.remove();
          report.count();
        }
      },
    });
  },
};
