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

/**
 * Convert short-circuit logical guards into structured if-statements.
 *
 * Anti-bot scripts avoid standard if-statements by substituting logical chains:
 *   isValid && (collectTelemetry(), transmitPayload());
 *   !ready || (initializeContext());
 *
 * This pass unwraps them into structured if-blocks for human readability.
 */
export const unwrapLogicalGuards = {
  name: 'unwrap-logical-guards',
  description: 'Transform short-circuit logical expressions into structured if-statements.',
  run(ast, report) {
    let unwrapped = 0;

    traverse(ast, {
      ExpressionStatement(path) {
        const expr = path.node.expression;
        if (!t.isLogicalExpression(expr)) return;
        if (!ensureInBlock(path)) return;

        const { operator, left, right } = expr;
        let condition = null;

        if (operator === '&&') {
          condition = t.cloneNode(left, true);
        } else if (operator === '||') {
          if (t.isUnaryExpression(left) && left.operator === '!') {
            condition = t.cloneNode(left.argument, true);
          } else {
            condition = t.unaryExpression('!', t.cloneNode(left, true));
          }
        }

        if (!condition) return;

        let bodyStatements = [];
        if (t.isSequenceExpression(right)) {
          bodyStatements = right.expressions.map((e) => t.expressionStatement(t.cloneNode(e, true)));
        } else {
          bodyStatements = [t.expressionStatement(t.cloneNode(right, true))];
        }

        path.replaceWith(t.ifStatement(condition, t.blockStatement(bodyStatements)));
        unwrapped++;
      },
    });

    report.count(unwrapped);
    if (unwrapped > 0) {
      report.note(`unwrapped ${unwrapped} logical guard expression(s) into if-statements`);
    }
  },
};
