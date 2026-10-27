import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
import { literalValueOf } from '../utils/ast.js';

const traverse = traverseModule.default ?? traverseModule;

/**
 * Remove code whose fate is already decided by a literal: dead if/else
 * branches, constant conditionals, `while (false)`, and no-op literal
 * expression statements.
 */
export const removeDeadCode = {
  name: 'remove-dead-code',
  description: 'Drop literal-decided branches, constant conditionals, and no-op statements.',
  run(ast, report) {
    traverse(ast, {
      IfStatement(path) {
        const test = literalValueOf(path, path.node.test);
        if (!test.ok) return;
        const truthy = Boolean(test.value);
        const branch = truthy ? path.node.consequent : path.node.alternate;
        if (!branch) {
          path.remove();
        } else {
          const statements = t.isBlockStatement(branch) ? branch.body : [branch];
          if (statements.length === 0) path.remove();
          else path.replaceWithMultiple(statements);
        }
        report.count();
      },
      ConditionalExpression(path) {
        const test = literalValueOf(path, path.node.test);
        if (!test.ok) return;
        path.replaceWith(test.value ? path.node.consequent : path.node.alternate);
        report.count();
      },
      WhileStatement(path) {
        const test = literalValueOf(path, path.node.test);
        if (test.ok && !test.value) {
          path.remove();
          report.count();
        }
      },
      ExpressionStatement(path) {
        const expression = path.node.expression;
        if (t.isStringLiteral(expression) || t.isNumericLiteral(expression) || t.isBooleanLiteral(expression)) {
          path.remove();
          report.count();
        }
      },
    });
  },
};
