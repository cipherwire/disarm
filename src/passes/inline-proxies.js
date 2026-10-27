import traverseModule from '@babel/traverse';
import * as t from '@babel/types';

const traverse = traverseModule.default ?? traverseModule;

/**
 * Check if a node is side-effect-free (safe to duplicate or discard).
 */
function isPureNode(node) {
  if (!node) return true;
  if (
    t.isNumericLiteral(node) ||
    t.isStringLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    t.isIdentifier(node)
  ) {
    return true;
  }
  if (t.isUnaryExpression(node)) return isPureNode(node.argument);
  if (t.isBinaryExpression(node)) return isPureNode(node.left) && isPureNode(node.right);
  if (t.isMemberExpression(node) && !node.computed) return isPureNode(node.object);
  return false;
}

/**
 * Extract simple return expression from a function body:
 *   function (a, b) { return a + b; } -> a + b
 *   (a, b) => a + b -> a + b
 */
function getReturnExpr(node) {
  if (!node) return null;
  if (t.isArrowFunctionExpression(node) && !t.isBlockStatement(node.body)) {
    return node.body;
  }
  const body = node.body;
  if (!t.isBlockStatement(body)) return null;
  if (body.body.length !== 1) return null;
  const first = body.body[0];
  if (t.isReturnStatement(first) && first.argument) {
    return first.argument;
  }
  return null;
}

/**
 * Check if an expression is a valid proxy candidate:
 * call, binary, unary, logical, member, or identifier.
 */
function isValidProxyExpr(expr) {
  return (
    t.isCallExpression(expr) ||
    t.isBinaryExpression(expr) ||
    t.isUnaryExpression(expr) ||
    t.isLogicalExpression(expr) ||
    t.isMemberExpression(expr) ||
    t.isIdentifier(expr)
  );
}

/**
 * Inline proxy wrapper functions and proxy object dictionaries.
 *
 * Anti-bot challenge scripts hide operations and decoders behind proxy layers:
 *   1. Wrapper functions: function fn(p1, p2, p3) { return decoder(p1 - 0x10, p2); }
 *   2. Object dictionaries: var obj = { add: function(a, b) { return a + b; }, key: "str" };
 *
 * Inlining these simplifies the AST so constant folding and string-bank
 * harvesting can reach the direct underlying calls.
 */
export const inlineProxies = {
  name: 'inline-proxies',
  description: 'Inline single-return wrapper functions and proxy object dictionaries.',
  run(ast, report) {
    let inlinedCalls = 0;

    // -------------------------------------------------------------------------
    // 1. Standalone wrapper functions
    // -------------------------------------------------------------------------
    const functionProxies = new Map(); // name -> { paramNames, expr, path }

    traverse(ast, {
      FunctionDeclaration(path) {
        const { id, params } = path.node;
        if (!id || !t.isIdentifier(id)) return;
        const expr = getReturnExpr(path.node);
        if (!expr || !isValidProxyExpr(expr)) return;
        // Avoid recursive self-calls
        if (t.isCallExpression(expr) && t.isIdentifier(expr.callee) && expr.callee.name === id.name) {
          return;
        }
        functionProxies.set(id.name, {
          paramNames: params.filter((p) => t.isIdentifier(p)).map((p) => p.name),
          expr,
          path,
        });
      },
      VariableDeclarator(path) {
        const { id, init } = path.node;
        if (!t.isIdentifier(id) || !init) return;
        if (!t.isFunctionExpression(init) && !t.isArrowFunctionExpression(init)) return;
        const expr = getReturnExpr(init);
        if (!expr || !isValidProxyExpr(expr)) return;
        functionProxies.set(id.name, {
          paramNames: init.params.filter((p) => t.isIdentifier(p)).map((p) => p.name),
          expr,
          path,
        });
      },
    });

    if (functionProxies.size > 0) {
      traverse(ast, {
        CallExpression(path) {
          const callee = path.node.callee;
          if (!t.isIdentifier(callee) || !functionProxies.has(callee.name)) return;
          const proxy = functionProxies.get(callee.name);
          const args = path.node.arguments;

          // Check that all arguments beyond param count or unused params are pure
          const paramSet = new Set(proxy.paramNames);
          const usedParamSet = new Set();
          function findUsedParams(node) {
            if (!node || typeof node !== 'object') return;
            if (t.isIdentifier(node) && paramSet.has(node.name)) {
              usedParamSet.add(node.name);
            }
            for (const key of Object.keys(node)) {
              if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
              if (Array.isArray(node[key])) {
                for (const item of node[key]) findUsedParams(item);
              } else if (typeof node[key] === 'object') {
                findUsedParams(node[key]);
              }
            }
          }
          findUsedParams(proxy.expr);

          for (let i = 0; i < args.length; i++) {
            const paramName = proxy.paramNames[i];
            if ((!paramName || !usedParamSet.has(paramName)) && !isPureNode(args[i])) {
              return; // Unused arg has side effects, do not drop
            }
          }

          const paramMap = new Map();
          proxy.paramNames.forEach((name, i) => {
            paramMap.set(name, args[i] ? t.cloneNode(args[i], true) : t.identifier('undefined'));
          });

          function substitute(node) {
            if (!node || typeof node !== 'object') return node;
            if (t.isIdentifier(node) && paramMap.has(node.name)) {
              return paramMap.get(node.name);
            }
            for (const key of Object.keys(node)) {
              if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
              if (Array.isArray(node[key])) {
                node[key] = node[key].map((item) => substitute(item));
              } else if (typeof node[key] === 'object') {
                node[key] = substitute(node[key]);
              }
            }
            return node;
          }

          const clonedExpr = t.cloneNode(proxy.expr, true);
          const inlined = substitute(clonedExpr);
          path.replaceWith(inlined);
          inlinedCalls++;
        },
      });
    }

    // -------------------------------------------------------------------------
    // 2. Object proxy dictionaries
    // -------------------------------------------------------------------------
    const objectProxies = new Map(); // objName -> Map<propKey, { isLiteral, valueNode, paramNames, expr }>

    traverse(ast, {
      VariableDeclarator(path) {
        const { id, init } = path.node;
        if (!t.isIdentifier(id) || !init || !t.isObjectExpression(init)) return;
        const propMap = new Map();
        let validDict = true;

        for (const prop of init.properties) {
          if (!t.isObjectProperty(prop)) {
            validDict = false;
            break;
          }
          let key;
          if (!prop.computed && t.isIdentifier(prop.key)) {
            key = prop.key.name;
          } else if (t.isStringLiteral(prop.key)) {
            key = prop.key.value;
          } else {
            validDict = false;
            break;
          }

          const val = prop.value;
          if (t.isStringLiteral(val) || t.isNumericLiteral(val) || t.isBooleanLiteral(val)) {
            propMap.set(key, { isLiteral: true, node: val });
          } else if (t.isFunctionExpression(val) || t.isArrowFunctionExpression(val)) {
            const expr = getReturnExpr(val);
            if (expr && isValidProxyExpr(expr)) {
              propMap.set(key, {
                isLiteral: false,
                paramNames: val.params.filter((p) => t.isIdentifier(p)).map((p) => p.name),
                expr,
              });
            } else {
              validDict = false;
              break;
            }
          } else {
            validDict = false;
            break;
          }
        }

        if (validDict && propMap.size > 0) {
          objectProxies.set(id.name, { propMap, path });
        }
      },
    });

    if (objectProxies.size > 0) {
      traverse(ast, {
        CallExpression(path) {
          const callee = path.node.callee;
          if (!t.isMemberExpression(callee)) return;
          if (!t.isIdentifier(callee.object) || !objectProxies.has(callee.object.name)) return;
          const dict = objectProxies.get(callee.object.name);
          let key;
          if (!callee.computed && t.isIdentifier(callee.property)) {
            key = callee.property.name;
          } else if (callee.computed && t.isStringLiteral(callee.property)) {
            key = callee.property.value;
          } else {
            return;
          }

          const entry = dict.propMap.get(key);
          if (!entry || entry.isLiteral) return;
          const args = path.node.arguments;
          const paramMap = new Map();
          entry.paramNames.forEach((name, i) => {
            paramMap.set(name, args[i] ? t.cloneNode(args[i], true) : t.identifier('undefined'));
          });

          function substitute(node) {
            if (!node || typeof node !== 'object') return node;
            if (t.isIdentifier(node) && paramMap.has(node.name)) {
              return paramMap.get(node.name);
            }
            for (const propKey of Object.keys(node)) {
              if (propKey === 'loc' || propKey === 'leadingComments' || propKey === 'trailingComments') continue;
              if (Array.isArray(node[propKey])) {
                node[propKey] = node[propKey].map((item) => substitute(item));
              } else if (typeof node[propKey] === 'object') {
                node[propKey] = substitute(node[propKey]);
              }
            }
            return node;
          }

          const clonedExpr = t.cloneNode(entry.expr, true);
          const inlined = substitute(clonedExpr);
          path.replaceWith(inlined);
          inlinedCalls++;
        },
        MemberExpression(path) {
          // If this member expression is the callee of a CallExpression, let the CallExpression handler deal with it
          if (path.parentPath?.isCallExpression() && path.parentPath.node.callee === path.node) return;
          if (!t.isIdentifier(path.node.object) || !objectProxies.has(path.node.object.name)) return;
          const dict = objectProxies.get(path.node.object.name);
          let key;
          if (!path.node.computed && t.isIdentifier(path.node.property)) {
            key = path.node.property.name;
          } else if (path.node.computed && t.isStringLiteral(path.node.property)) {
            key = path.node.property.value;
          } else {
            return;
          }

          const entry = dict.propMap.get(key);
          if (!entry || !entry.isLiteral) return;
          path.replaceWith(t.cloneNode(entry.node, true));
          inlinedCalls++;
        },
      });
    }

    // -------------------------------------------------------------------------
    // 3. Remove unreferenced proxy functions and unreferenced object dictionaries
    // -------------------------------------------------------------------------
    for (const [name, proxy] of functionProxies.entries()) {
      try {
        const binding = proxy.path.scope.getBinding(name);
        if (binding && binding.referencePaths.length === 0) {
          proxy.path.remove();
          inlinedCalls++;
        }
      } catch {
        // Safe to ignore if already detached
      }
    }

    for (const [name, dict] of objectProxies.entries()) {
      try {
        const binding = dict.path.scope.getBinding(name);
        if (binding && binding.referencePaths.length === 0) {
          dict.path.remove();
          inlinedCalls++;
        }
      } catch {
        // Safe to ignore if already detached
      }
    }

    report.count(inlinedCalls);
    if (inlinedCalls > 0) {
      report.note(`inlined ${inlinedCalls} proxy function/object call(s) and property access(es)`);
    }
  },
};
