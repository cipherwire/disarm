import traverseModule from '@babel/traverse';
import * as t from '@babel/types';

const traverse = traverseModule.default ?? traverseModule;

/** Scan a function body for debugger statements or Function-constructor calls.
 * The constructor call is matched structurally regardless of its arguments:
 * obfuscators build `Function("debu" + "gger")` from string-bank pieces, so
 * no literal "debugger" ever appears in the raw source. In challenge-script
 * territory, dynamic Function-constructor use is hostile by default. */
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
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = node.callee;
      const isFunctionCtor =
        (t.isIdentifier(callee) && callee.name === 'Function') ||
        (t.isMemberExpression(callee) &&
          ((t.isIdentifier(callee.property) && callee.property.name === 'constructor') ||
            (t.isStringLiteral(callee.property) && callee.property.value === 'constructor')));
      if (isFunctionCtor && (node.arguments ?? []).length > 0) {
        found = true;
        return;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      walk(node[key]);
    }
  })(body);
  return found;
}

/**
 * Remove anti-analysis debugger traps BEFORE anything evaluates the script:
 * functions whose body contains `debugger` or Function("debugger"), plus the
 * calls and setInterval/setTimeout registrations that drive them. Stripped
 * traps cannot fire :  neither in our sandbox nor during analysis.
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

    traverse(ast, {
      'FunctionDeclaration|FunctionExpression'(path) {
        if (!bodyHasDebuggerTrap(path.node.body)) return;
        const parent = path.parentPath;
        if (t.isFunctionDeclaration(path.node) && path.node.id) {
          defs.push({ path, name: path.node.id.name });
        } else if (parent?.isVariableDeclarator() && t.isIdentifier(parent.node.id)) {
          defs.push({ path: parent, name: parent.node.id.name });
        } else if (parent?.isAssignmentExpression() && t.isIdentifier(parent.node.left)) {
          defs.push({ path: parent, name: parent.node.left.name });
        } else if (parent?.isCallExpression()) {
          // Inline interval callback: setInterval(function () { ...debugger... }, n)
          const callee = parent.node.callee;
          if (t.isIdentifier(callee) && (callee.name === 'setInterval' || callee.name === 'setTimeout')) {
            const statement = parent.getStatementParent();
            if (statement) {
              removeStatement(statement);
              report.count();
            }
          }
        }
      },
    });

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
      // Call sites of removed trap functions, including interval registrations.
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
          // Interval registrations may route through members:
          // window.setInterval(trapFn, n) / window['setInterval'](trapFn, n)
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

    // Stray Function("debugger") calls :  parser decodes \x-escapes, so these
    // match even when the source hides the word. Runs regardless of defs so
    // scripts without named trap functions are still cleaned.
    traverse(ast, {
      'CallExpression|NewExpression'(path) {
        const callee = path.node.callee;
        const isFunctionCtor =
          (t.isIdentifier(callee) && callee.name === 'Function') ||
          (t.isMemberExpression(callee) && !callee.computed &&
            t.isIdentifier(callee.property) && callee.property.name === 'constructor');
        if (!isFunctionCtor) return;
        if (!path.node.arguments.some((arg) => t.isStringLiteral(arg) && arg.value.includes('debugger'))) return;
        const statement = path.getStatementParent();
        if (statement) {
          removeStatement(statement);
          report.count();
        }
      },
    });

    if (defs.length === 0) report.note('no debugger traps found');
  },
};
