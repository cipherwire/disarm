import traverseModule from '@babel/traverse';
import * as t from '@babel/types';

const traverse = traverseModule.default ?? traverseModule;

function isFunctionDebuggerCall(node) {
  if (!node) return false;
  if (!t.isCallExpression(node) && !t.isNewExpression(node)) return false;
  const callee = node.callee;
  const isFunctionCtor =
    (t.isIdentifier(callee) && callee.name === 'Function') ||
    (t.isMemberExpression(callee) &&
      ((!callee.computed && t.isIdentifier(callee.property) && callee.property.name === 'constructor') ||
        (callee.computed && t.isStringLiteral(callee.property) && callee.property.value === 'constructor')));
  if (
    isFunctionCtor &&
    (node.arguments ?? []).some((arg) => t.isStringLiteral(arg) && arg.value.includes('debugger'))
  ) {
    return true;
  }
  return false;
}

function isDebuggerCall(node) {
  if (!node) return false;
  if (!t.isCallExpression(node) && !t.isNewExpression(node)) return false;
  if (isFunctionDebuggerCall(node)) return true;
  if (isFunctionDebuggerCall(node.callee)) return true;
  if (t.isMemberExpression(node.callee)) {
    const prop = node.callee.property;
    const isCallOrApply =
      (!node.callee.computed && t.isIdentifier(prop) && (prop.name === 'call' || prop.name === 'apply')) ||
      (node.callee.computed && t.isStringLiteral(prop) && (prop.value === 'call' || prop.value === 'apply'));
    if (isCallOrApply && (isFunctionDebuggerCall(node.callee.object) || isDebuggerCall(node.callee.object))) {
      return true;
    }
  }
  return false;
}

/** Scan a function body for debugger statements or Function-constructor calls. */
function bodyHasDebuggerTrap(body) {
  let found = false;
  (function walk(node) {
    if (!node || typeof node !== 'object' || found) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node.type === 'DebuggerStatement') {
      found = true;
      return;
    }
    if (isDebuggerCall(node)) {
      found = true;
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      walk(node[key]);
    }
  })(body);
  return found;
}

/** Determine if a function exists solely as a debugger trap wrapper. */
function isDedicatedTrapFunction(fnNode) {
  if (!fnNode) return false;
  const body = fnNode.body;
  if (!body) return false;
  if (!bodyHasDebuggerTrap(body)) return false;

  if (!t.isBlockStatement(body)) {
    return isDebuggerCall(body);
  }

  const localTrapNames = new Set();
  for (const stmt of body.body) {
    if (t.isFunctionDeclaration(stmt) && stmt.id && isDedicatedTrapFunction(stmt)) {
      localTrapNames.add(stmt.id.name);
    }
  }

  const isTrapExpr = (expr) => {
    if (!expr) return true;
    if (t.isIdentifier(expr, { name: 'undefined' })) return true;
    if (t.isUnaryExpression(expr) && expr.operator === 'void') return true;
    if (isDebuggerCall(expr)) return true;
    if (t.isCallExpression(expr)) {
      const callee = expr.callee;
      if (t.isIdentifier(callee) && localTrapNames.has(callee.name)) return true;
      const isTimer =
        (t.isIdentifier(callee) && (callee.name === 'setInterval' || callee.name === 'setTimeout')) ||
        (t.isMemberExpression(callee) &&
          ((!callee.computed && t.isIdentifier(callee.property) && (callee.property.name === 'setInterval' || callee.property.name === 'setTimeout')) ||
            (callee.computed && t.isStringLiteral(callee.property) && (callee.property.value === 'setInterval' || callee.property.value === 'setTimeout'))));
      if (isTimer) return true;
      if (t.isFunctionExpression(callee) || t.isArrowFunctionExpression(callee)) {
        return isDedicatedTrapFunction(callee);
      }
      if (
        t.isMemberExpression(callee) &&
        (t.isIdentifier(callee.property, { name: 'call' }) || t.isIdentifier(callee.property, { name: 'apply' }))
      ) {
        if (t.isIdentifier(callee.object) && localTrapNames.has(callee.object.name)) return true;
      }
    }
    return false;
  };

  const isTrapStatement = (stmt) => {
    if (!stmt) return true;
    if (t.isEmptyStatement(stmt)) return true;
    if (t.isDebuggerStatement(stmt)) return true;
    if (t.isReturnStatement(stmt)) {
      if (!stmt.argument) return true;
      return isTrapExpr(stmt.argument);
    }
    if (t.isExpressionStatement(stmt)) {
      return isTrapExpr(stmt.expression);
    }
    if (t.isBlockStatement(stmt)) {
      return stmt.body.every(isTrapStatement);
    }
    if (t.isIfStatement(stmt)) {
      return isTrapStatement(stmt.consequent) && (!stmt.alternate || isTrapStatement(stmt.alternate));
    }
    if (t.isTryStatement(stmt)) {
      return (
        isTrapStatement(stmt.block) &&
        (!stmt.handler || isTrapStatement(stmt.handler.body)) &&
        (!stmt.finalizer || isTrapStatement(stmt.finalizer))
      );
    }
    if (t.isWhileStatement(stmt) || t.isDoWhileStatement(stmt) || t.isForStatement(stmt)) {
      return isTrapStatement(stmt.body);
    }
    if (t.isFunctionDeclaration(stmt)) {
      return isDedicatedTrapFunction(stmt);
    }
    if (t.isVariableDeclaration(stmt)) {
      return stmt.declarations.every((decl) => !decl.init || isTrapExpr(decl.init));
    }
    return false;
  };

  return body.body.every(isTrapStatement);
}

/**
 * Remove anti-analysis debugger traps BEFORE anything evaluates the script:
 * dedicated functions whose body contains debugger traps, plus the
 * calls and setInterval/setTimeout registrations that drive them. Standalone
 * debugger statements and Function("debugger") sub-expressions in business
 * code are neutralized without destroying surrounding logic.
 */
export const stripDebugTraps = {
  name: 'strip-debug-traps',
  description: 'Remove debugger-trap functions, their call sites, and interval registrations.',
  run(ast, report, context) {
    const annotate = Boolean(context?.options?.annotate);
    const defs = []; // { path, name }

    const removeStatement = (stmtPath) => {
      if (annotate) {
        try {
          const empty = t.emptyStatement();
          t.addComment(empty, 'leading', ' [disarm] Defeated debugger trap', true);
          stmtPath.replaceWith(empty);
          return;
        } catch {
          // fallback to removal
        }
      }
      stmtPath.remove();
    };

    // 1. Unified traversal: identify dedicated trap functions, remove standalone debugger
    // statements, and neutralize sub-expression Function("debugger") calls in one pass.
    traverse(ast, {
      'FunctionDeclaration|FunctionExpression'(path) {
        if (!isDedicatedTrapFunction(path.node)) return;
        const parent = path.parentPath;
        if (t.isFunctionDeclaration(path.node) && path.node.id) {
          defs.push({ path, name: path.node.id.name });
        } else if (parent?.isVariableDeclarator() && t.isIdentifier(parent.node.id)) {
          defs.push({ path: parent, name: parent.node.id.name });
        } else if (parent?.isAssignmentExpression() && t.isIdentifier(parent.node.left)) {
          defs.push({ path: parent, name: parent.node.left.name });
        } else if (parent?.isCallExpression()) {
          const callee = parent.node.callee;
          const isTimer =
            (t.isIdentifier(callee) && (callee.name === 'setInterval' || callee.name === 'setTimeout')) ||
            (t.isMemberExpression(callee) &&
              ((!callee.computed && t.isIdentifier(callee.property) &&
                (callee.property.name === 'setInterval' || callee.property.name === 'setTimeout')) ||
                (callee.computed && t.isStringLiteral(callee.property) &&
                  (callee.property.value === 'setInterval' || callee.property.value === 'setTimeout'))));
          if (isTimer) {
            const statement = parent.getStatementParent();
            if (statement) {
              removeStatement(statement);
              report.count();
            }
          }
        }
      },
      DebuggerStatement(path) {
        if (
          path.parentPath?.isIfStatement() ||
          path.parentPath?.isWhileStatement() ||
          path.parentPath?.isForStatement()
        ) {
          path.replaceWith(t.emptyStatement());
        } else {
          removeStatement(path);
        }
        report.count();
      },
      'CallExpression|NewExpression'(path) {
        if (!isFunctionDebuggerCall(path.node)) return;

        let topExprPath = path;
        while (topExprPath.parentPath) {
          const parent = topExprPath.parentPath;
          if (parent.isCallExpression() && parent.node.callee === topExprPath.node) {
            topExprPath = parent;
          } else if (
            parent.isMemberExpression() &&
            parent.node.object === topExprPath.node &&
            ((!parent.node.computed &&
              t.isIdentifier(parent.node.property) &&
              (parent.node.property.name === 'call' || parent.node.property.name === 'apply')) ||
              (parent.node.computed &&
                t.isStringLiteral(parent.node.property) &&
                (parent.node.property.value === 'call' || parent.node.property.value === 'apply')))
          ) {
            topExprPath = parent;
          } else {
            break;
          }
        }

        if (topExprPath.parentPath?.isExpressionStatement()) {
          removeStatement(topExprPath.parentPath);
          report.count();
        } else {
          topExprPath.replaceWith(t.identifier('undefined'));
          report.count();
        }
      },
    });

    // 2. Remove identified trap functions and clean up their call sites
    if (defs.length > 0) {
      const names = new Set(defs.map((def) => def.name).filter(Boolean));
      for (const def of defs) {
        try {
          def.path.remove();
        } catch {
          // already detached by an overlapping removal
        }
      }
      report.count(defs.length);

      traverse(ast, {
        ExpressionStatement(path) {
          const expression = path.node.expression;
          if (!t.isCallExpression(expression)) return;
          const callee = expression.callee;
          if (t.isIdentifier(callee) && names.has(callee.name)) {
            removeStatement(path);
            report.count();
            return;
          }
          const isTimerCall =
            (t.isIdentifier(callee) && (callee.name === 'setInterval' || callee.name === 'setTimeout')) ||
            (t.isMemberExpression(callee) &&
              ((!callee.computed && t.isIdentifier(callee.property) &&
                (callee.property.name === 'setInterval' || callee.property.name === 'setTimeout')) ||
                (callee.computed && t.isStringLiteral(callee.property) &&
                  (callee.property.value === 'setInterval' || callee.property.value === 'setTimeout'))));
          if (isTimerCall && t.isIdentifier(expression.arguments[0]) && names.has(expression.arguments[0].name)) {
            removeStatement(path);
            report.count();
          }
        },
      });
    }

    if (defs.length === 0) report.note('no debugger traps found');
  },
};
