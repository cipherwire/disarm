import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
import { JUNK_NAME_RE } from '../utils/ast.js';

const traverse = traverseModule.default ?? traverseModule;

const RESERVED = new Set(['undefined', 'NaN', 'Infinity']);

/**
 * Rename obfuscator-generated junk (`_0x4f2a`, `td_Ab3`) into readable,
 * consistent names. Two layers:
 *   1. scope-aware renames for declared variables/functions/parameters,
 *   2. a globally consistent rename for member property / object key names.
 */
export const renameIdentifiers = {
  name: 'rename-identifiers',
  description: 'Rename junk identifiers (_0x…, td_…) to readable, consistent names.',
  run(ast, report) {
    const used = new Set();
    const declTargets = [];
    const paramTargets = [];
    const propKeys = new Set();

    const keyOf = (node) => {
      if (t.isMemberExpression(node)) {
        if (!node.computed && t.isIdentifier(node.property) && JUNK_NAME_RE.test(node.property.name)) {
          return node.property.name;
        }
        if (
          node.computed &&
          t.isStringLiteral(node.property) &&
          t.isValidIdentifier(node.property.value) &&
          JUNK_NAME_RE.test(node.property.value)
        ) {
          return node.property.value;
        }
        return null;
      }
      if (t.isObjectProperty(node) && node.shorthand) return null;
      if (!node.computed && t.isIdentifier(node.key) && JUNK_NAME_RE.test(node.key.name)) {
        return node.key.name;
      }
      if (
        node.computed &&
        t.isStringLiteral(node.key) &&
        t.isValidIdentifier(node.key.value) &&
        JUNK_NAME_RE.test(node.key.value)
      ) {
        return node.key.value;
      }
      return null;
    };

    // Single unified collection pass
    traverse(ast, {
      Identifier(path) {
        used.add(path.node.name);
      },
      FunctionDeclaration(path) {
        const id = path.node.id;
        if (id && JUNK_NAME_RE.test(id.name)) {
          declTargets.push({ type: 'fn', path, name: id.name });
        }
      },
      VariableDeclarator(path) {
        const id = path.node.id;
        if (t.isIdentifier(id) && JUNK_NAME_RE.test(id.name)) {
          const isFunction =
            path.node.init &&
            (t.isFunctionExpression(path.node.init) || t.isArrowFunctionExpression(path.node.init));
          declTargets.push({ type: isFunction ? 'fn' : 'v', path, name: id.name });
        }
      },
      'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression'(path) {
        for (const param of path.node.params) {
          if (t.isIdentifier(param) && JUNK_NAME_RE.test(param.name)) {
            paramTargets.push({ path, name: param.name });
          }
        }
      },
      'MemberExpression|ObjectProperty|ObjectMethod'(path) {
        const key = keyOf(path.node);
        if (key && !propKeys.has(key)) propKeys.add(key);
      },
    });

    // If no junk identifiers exist in the AST, exit immediately
    if (declTargets.length === 0 && paramTargets.length === 0 && propKeys.size === 0) {
      return;
    }

    const counters = {};
    const fresh = (prefix) => {
      let name;
      do {
        counters[prefix] = (counters[prefix] ?? 0) + 1;
        name = prefix + counters[prefix];
      } while (used.has(name) || RESERVED.has(name));
      used.add(name);
      return name;
    };

    // 1. Declarations with scope tracking
    for (const target of declTargets) {
      const binding = target.path.scope.getBinding(target.name);
      if (!binding) continue;
      binding.scope.rename(target.name, fresh(target.type));
      report.count();
    }

    for (const target of paramTargets) {
      const binding = target.path.scope.getBinding(target.name);
      if (!binding) continue;
      binding.scope.rename(target.name, fresh('p'));
      report.count();
    }

    // 2. Member properties and object keys
    const propMap = new Map();
    for (const key of propKeys) {
      propMap.set(key, fresh('m'));
    }

    if (propMap.size > 0) {
      traverse(ast, {
        MemberExpression(path) {
          const property = path.node.property;
          if (!path.node.computed && t.isIdentifier(property) && propMap.has(property.name)) {
            property.name = propMap.get(property.name);
            report.count();
          } else if (path.node.computed && t.isStringLiteral(property) && propMap.has(property.value)) {
            path.node.property = t.identifier(propMap.get(property.value));
            path.node.computed = false;
            report.count();
          }
        },
        'ObjectProperty|ObjectMethod'(path) {
          const key = path.node.key;
          if (t.isObjectProperty(path.node) && path.node.shorthand) return;
          if (!path.node.computed && t.isIdentifier(key) && propMap.has(key.name)) {
            key.name = propMap.get(key.name);
            report.count();
          } else if (path.node.computed && t.isStringLiteral(key) && propMap.has(key.value)) {
            path.node.key = t.identifier(propMap.get(key.value));
            path.node.computed = false;
            report.count();
          }
        },
      });
    }
  },
};
