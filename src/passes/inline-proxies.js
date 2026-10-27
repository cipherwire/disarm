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
 * Scope-safe parameter substitution that avoids corrupting non-computed member properties,
 * object property keys, and inner function parameters/declarations.
 */
function substituteParams(astNode, paramMap) {
  function walk(node, parent) {
    if (!node || typeof node !== 'object') return node;

    // Do NOT replace member expression non-computed properties: obj.prop
    if (t.isIdentifier(node) && parent && t.isMemberExpression(parent) && parent.property === node && !parent.computed) {
      return node;
    }

    // Do NOT replace object literal non-computed keys: { key: value }
    if (t.isIdentifier(node) && parent && t.isObjectProperty(parent) && parent.key === node && !parent.computed) {
      return node;
    }

    // Do NOT replace function or parameter declaration identifiers
    if (parent && (t.isFunctionDeclaration(parent) || t.isFunctionExpression(parent) || t.isArrowFunctionExpression(parent))) {
      if (parent.params.includes(node) || parent.id === node) return node;
    }

    if (t.isIdentifier(node) && paramMap.has(node.name)) {
      return t.cloneNode(paramMap.get(node.name), true);
    }

    let activeMap = paramMap;
    if (t.isFunction(node)) {
      let shadowed = null;
      for (const p of node.params) {
        if (t.isIdentifier(p) && paramMap.has(p.name)) {
          if (!shadowed) shadowed = new Map(paramMap);
          shadowed.delete(p.name);
        }
      }
      if (shadowed) activeMap = shadowed;
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (let i = 0; i < child.length; i++) {
          child[i] = walk(child[i], node);
        }
      } else if (typeof child === 'object') {
        node[key] = walk(child, node);
      }
    }
    return node;
  }

  return walk(astNode, null);
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

    traverse(ast, {
      FunctionDeclaration(path) {
        const { id, params } = path.node;
        if (!id || !t.isIdentifier(id)) return;
        const expr = getReturnExpr(path.node);
        if (!expr || !isValidProxyExpr(expr)) return;
        // Avoid recursive self-calls
        if (t.isCallExpression(expr) && t.isIdentifier(expr.callee) && expr.callee.name === id.name) return;

        const binding = path.scope.getBinding(id.name);
        if (!binding || !binding.constant) return;
        if (binding.referencePaths.length === 0) return;

        const paramNames = params.filter((p) => t.isIdentifier(p)).map((p) => p.name);
        const paramSet = new Set(paramNames);
        const usedParamSet = new Set();
        function findUsedParams(node) {
          if (!node || typeof node !== 'object') return;
          if (t.isIdentifier(node) && paramSet.has(node.name)) usedParamSet.add(node.name);
          for (const key of Object.keys(node)) {
            if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
            if (Array.isArray(node[key])) node[key].forEach(findUsedParams);
            else if (typeof node[key] === 'object') findUsedParams(node[key]);
          }
        }
        findUsedParams(expr);

        const refs = [...binding.referencePaths];
        let inlinedForThisProxy = 0;
        for (const refPath of refs) {
          if (!refPath.parentPath?.isCallExpression() || refPath.parentPath.node.callee !== refPath.node) {
            continue;
          }
          const callPath = refPath.parentPath;
          const args = callPath.node.arguments;

          let safeArgs = true;
          for (let i = 0; i < args.length; i++) {
            const pName = paramNames[i];
            if ((!pName || !usedParamSet.has(pName)) && !isPureNode(args[i])) {
              safeArgs = false;
              break;
            }
          }
          if (!safeArgs) continue;

          const paramMap = new Map();
          paramNames.forEach((name, i) => {
            paramMap.set(name, args[i] ? t.cloneNode(args[i], true) : t.identifier('undefined'));
          });

          const cloned = t.cloneNode(expr, true);
          const inlined = substituteParams(cloned, paramMap);
          callPath.replaceWith(inlined);
          inlinedForThisProxy++;
          inlinedCalls++;
        }

        if (inlinedForThisProxy === refs.length && refs.length > 0) {
          try {
            path.remove();
            inlinedCalls++;
          } catch {}
        }
      },

      VariableDeclarator(path) {
        const { id, init } = path.node;
        if (!t.isIdentifier(id) || !init) return;

        const binding = path.scope.getBinding(id.name);
        if (!binding || !binding.constant) return;
        if (binding.referencePaths.length === 0) return;

        // Case 1: Function expression / arrow function proxy
        if (t.isFunctionExpression(init) || t.isArrowFunctionExpression(init)) {
          const expr = getReturnExpr(init);
          if (!expr || !isValidProxyExpr(expr)) return;

          const paramNames = init.params.filter((p) => t.isIdentifier(p)).map((p) => p.name);
          const paramSet = new Set(paramNames);
          const usedParamSet = new Set();
          function findUsedParams(node) {
            if (!node || typeof node !== 'object') return;
            if (t.isIdentifier(node) && paramSet.has(node.name)) usedParamSet.add(node.name);
            for (const key of Object.keys(node)) {
              if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
              if (Array.isArray(node[key])) node[key].forEach(findUsedParams);
              else if (typeof node[key] === 'object') findUsedParams(node[key]);
            }
          }
          findUsedParams(expr);

          const refs = [...binding.referencePaths];
          let inlinedForThisProxy = 0;
          for (const refPath of refs) {
            if (!refPath.parentPath?.isCallExpression() || refPath.parentPath.node.callee !== refPath.node) {
              continue;
            }
            const callPath = refPath.parentPath;
            const args = callPath.node.arguments;

            let safeArgs = true;
            for (let i = 0; i < args.length; i++) {
              const pName = paramNames[i];
              if ((!pName || !usedParamSet.has(pName)) && !isPureNode(args[i])) {
                safeArgs = false;
                break;
              }
            }
            if (!safeArgs) continue;

            const paramMap = new Map();
            paramNames.forEach((name, i) => {
              paramMap.set(name, args[i] ? t.cloneNode(args[i], true) : t.identifier('undefined'));
            });

            const cloned = t.cloneNode(expr, true);
            const inlined = substituteParams(cloned, paramMap);
            callPath.replaceWith(inlined);
            inlinedForThisProxy++;
            inlinedCalls++;
          }

          if (inlinedForThisProxy === refs.length && refs.length > 0) {
            try {
              if (path.parentPath?.isVariableDeclaration() && path.parentPath.node.declarations.length === 1) {
                path.parentPath.remove();
              } else {
                path.remove();
              }
              inlinedCalls++;
            } catch {}
          }
          return;
        }

        // Case 2: Object dictionary proxy
        if (t.isObjectExpression(init)) {
          const propMap = new Map();
          for (const prop of init.properties) {
            if (!t.isObjectProperty(prop)) return;
            let key;
            if (!prop.computed && t.isIdentifier(prop.key)) key = prop.key.name;
            else if (t.isStringLiteral(prop.key)) key = prop.key.value;
            else return;

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
                return;
              }
            } else {
              return;
            }
          }

          if (propMap.size === 0) return;

          const refs = [...binding.referencePaths];
          let inlinedForThisProxy = 0;
          for (const refPath of refs) {
            const parentPath = refPath.parentPath;
            if (!parentPath?.isMemberExpression() || parentPath.node.object !== refPath.node) continue;

            let key;
            if (!parentPath.node.computed && t.isIdentifier(parentPath.node.property)) {
              key = parentPath.node.property.name;
            } else if (parentPath.node.computed && t.isStringLiteral(parentPath.node.property)) {
              key = parentPath.node.property.value;
            } else {
              continue;
            }

            const entry = propMap.get(key);
            if (!entry) continue;

            if (entry.isLiteral) {
              if (parentPath.parentPath?.isCallExpression() && parentPath.parentPath.node.callee === parentPath.node) {
                continue;
              }
              parentPath.replaceWith(t.cloneNode(entry.node, true));
              inlinedForThisProxy++;
              inlinedCalls++;
            } else {
              const callPath = parentPath.parentPath;
              if (!callPath?.isCallExpression() || callPath.node.callee !== parentPath.node) continue;
              const args = callPath.node.arguments;
              const paramMap = new Map();
              entry.paramNames.forEach((name, i) => {
                paramMap.set(name, args[i] ? t.cloneNode(args[i], true) : t.identifier('undefined'));
              });
              const cloned = t.cloneNode(entry.expr, true);
              const inlined = substituteParams(cloned, paramMap);
              callPath.replaceWith(inlined);
              inlinedForThisProxy++;
              inlinedCalls++;
            }
          }

          if (inlinedForThisProxy === refs.length && refs.length > 0) {
            try {
              if (path.parentPath?.isVariableDeclaration() && path.parentPath.node.declarations.length === 1) {
                path.parentPath.remove();
              } else {
                path.remove();
              }
              inlinedCalls++;
            } catch {}
          }
        }
      },
    });

    report.count(inlinedCalls);
    if (inlinedCalls > 0) {
      report.note(`inlined ${inlinedCalls} proxy function/object call(s) and property access(es)`);
    }
  },
};
