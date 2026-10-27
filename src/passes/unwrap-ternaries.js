import traverseModule from '@babel/traverse';
import * as t from '@babel/types';

const traverse = traverseModule.default ?? traverseModule;

function ensureInBlock(path) {
  const parent = path.parentPath;
  if (parent.isBlockStatement() || parent.isProgram()) return true;
  if (parent.isIfStatement() || parent.isLoop()) {
    path.replaceWith(t.blockStatement([t.cloneNode(path.node, true)]));
    return false;
  }
  return false;
}

function toStatements(node) {
  if (!node) return [];
  if (t.isSequenceExpression(node)) {
    return node.expressions.map((e) => t.expressionStatement(t.cloneNode(e, true)));
  }
  return [t.expressionStatement(t.cloneNode(node, true))];
}

function buildIfStatement(condExpr) {
  const { test, consequent, alternate } = condExpr;

  const consequentBlock = t.blockStatement(toStatements(consequent));

  let alternateNode = null;
  if (alternate) {
    if (t.isConditionalExpression(alternate)) {
      alternateNode = buildIfStatement(alternate);
    } else {
      const altStmts = toStatements(alternate);
      if (altStmts.length > 0) {
        alternateNode = t.blockStatement(altStmts);
      }
    }
  }

  return t.ifStatement(t.cloneNode(test, true), consequentBlock, alternateNode);
}

/**
 * Transform statement-level ternary expressions into structured if-else blocks.
 *
 * Obfuscators chain nested conditional expressions in statement positions to evade
 * standard if-else branch analysis:
 *   isValid ? (collectTelemetry(), transmit()) : (retryCount++, wait());
 *   mode === 1 ? handleA() : mode === 2 ? handleB() : handleDefault();
 *
 * This pass transforms them into readable if-else and else-if statements.
 */
export const unwrapTernaries = {
  name: 'unwrap-ternaries',
  description: 'Convert standalone statement ternaries into structured if-else statements.',
  run(ast, report) {
    let unwrapped = 0;

    traverse(ast, {
      ExpressionStatement(path) {
        let expr = path.node.expression;

        // Strip void wrapper: void (a ? b : c)
        if (t.isUnaryExpression(expr, { operator: 'void' })) {
          expr = expr.argument;
        }

        if (!t.isConditionalExpression(expr)) return;
        if (!ensureInBlock(path)) return;

        const ifStmt = buildIfStatement(expr);
        path.replaceWith(ifStmt);
        unwrapped++;
      },
    });

    report.count(unwrapped);
    if (unwrapped > 0) {
      report.note(`unwrapped ${unwrapped} statement ternary expression(s) into if-statements`);
    }
  },
};
