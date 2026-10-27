import traverseModule from '@babel/traverse';
import * as t from '@babel/types';

const traverse = traverseModule.default ?? traverseModule;

/**
 * Ensure a statement is enclosed within a BlockStatement or Program body
 * so replaceWithMultiple can be safely called without syntax tree corruption.
 */
function ensureInBlock(path) {
  const parent = path.parentPath;
  if (parent.isBlockStatement() || parent.isProgram()) return true;
  if (parent.isIfStatement() || parent.isLoop()) {
    path.replaceWith(t.blockStatement([t.cloneNode(path.node, true)]));
    return false;
  }
  return false;
}

/**
 * Split sequence expressions (comma operators) into distinct statements.
 *
 * Anti-bot scripts compress multi-line procedures into dense comma-separated
 * sequences to impede readability and line-by-line debugging:
 *   (a = 1, b = 2, c());
 *   return x = 10, y = 20, x + y;
 *
 * This pass unwraps sequences in ExpressionStatements, ReturnStatements,
 * and VariableDeclarations into clean sequential statements.
 */
export const splitSequences = {
  name: 'split-sequences',
  description: 'Unwrap comma-operator sequence expressions into independent sequential statements.',
  run(ast, report) {
    let unrolled = 0;

    traverse(ast, {
      ExpressionStatement(path) {
        if (!t.isSequenceExpression(path.node.expression)) return;
        if (!ensureInBlock(path)) return;
        const exprs = path.node.expression.expressions;
        const statements = exprs.map((e) => t.expressionStatement(t.cloneNode(e, true)));
        path.replaceWithMultiple(statements);
        unrolled += exprs.length - 1;
      },
      ReturnStatement(path) {
        if (!path.node.argument || !t.isSequenceExpression(path.node.argument)) return;
        if (!ensureInBlock(path)) return;
        const exprs = path.node.argument.expressions;
        if (exprs.length < 2) return;
        const statements = exprs.slice(0, -1).map((e) => t.expressionStatement(t.cloneNode(e, true)));
        statements.push(t.returnStatement(t.cloneNode(exprs[exprs.length - 1], true)));
        path.replaceWithMultiple(statements);
        unrolled += exprs.length - 1;
      },
      VariableDeclaration(path) {
        if (path.node.declarations.length !== 1) return;
        const decl = path.node.declarations[0];
        if (!decl.init || !t.isSequenceExpression(decl.init)) return;
        if (!ensureInBlock(path)) return;
        const exprs = decl.init.expressions;
        if (exprs.length < 2) return;
        const statements = exprs.slice(0, -1).map((e) => t.expressionStatement(t.cloneNode(e, true)));
        decl.init = t.cloneNode(exprs[exprs.length - 1], true);
        statements.push(t.cloneNode(path.node, true));
        path.replaceWithMultiple(statements);
        unrolled += exprs.length - 1;
      },
    });

    report.count(unrolled);
    if (unrolled > 0) {
      report.note(`unwrapped ${unrolled} comma sequence expression(s)`);
    }
  },
};
