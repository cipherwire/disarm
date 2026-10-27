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
    traverse(ast, {
      Identifier(path) {
        used.add(path.node.name);
      },
    });

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

    // 1. Declarations with scope tracking: rename binding + all references.
    traverse(ast, {
      FunctionDeclaration(path) {
        const id = path.node.id;
        if (!id || !JUNK_NAME_RE.test(id.name)) return;
        const binding = path.scope.getBinding(id.name);
        if (!binding) return;
        binding.scope.rename(id.name, fresh('fn'));
        report.count();
      },
      VariableDeclarator(path) {
        const id = path.node.id;
        if (!t.isIdentifier(id) || !JUNK_NAME_RE.test(id.name)) return;
        const binding = path.scope.getBinding(id.name);
        if (!binding) return;
        const isFunction = path.node.init &&
          (t.isFunctionExpression(path.node.init) || t.isArrowFunctionExpression(path.node.init));
        binding.scope.rename(id.name, fresh(isFunction ? 'fn' : 'v'));
        report.count();
      },
    });
    traverse(ast, {
      'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression'(path) {
        for (const param of path.node.params) {
          if (!t.isIdentifier(param) || !JUNK_NAME_RE.test(param.name)) continue;
          const binding = path.scope.getBinding(param.name);
          if (!binding) continue;
          binding.scope.rename(param.name, fresh('p'));
          report.count();
        }
      },
    });

    // 2. Member properties and object keys: not scope-tracked, so collect a
    //    consistent mapping first, then apply it everywhere.
    const propMap = new Map();
    const keyOf = (node) => {
      if (t.isMemberExpression(node)) {
        if (!node.computed && t.isIdentifier(node.property) && JUNK_NAME_RE.test(node.property.name)) {
          return node.property.name;
        }
        if (node.computed && t.isStringLiteral(node.property) &&
            t.isValidIdentifier(node.property.value) && JUNK_NAME_RE.test(node.property.value)) {
          return node.property.value;
        }
        return null;
      }
      if (t.isObjectProperty(node) && node.shorthand) return null;
      if (!node.computed && t.isIdentifier(node.key) && JUNK_NAME_RE.test(node.key.name)) {
        return node.key.name;
      }
      if (node.computed && t.isStringLiteral(node.key) &&
          t.isValidIdentifier(node.key.value) && JUNK_NAME_RE.test(node.key.value)) {
        return node.key.value;
      }
      return null;
    };

    traverse(ast, {
      'MemberExpression|ObjectProperty|ObjectMethod'(path) {
        const key = keyOf(path.node);
        if (key && !propMap.has(key)) propMap.set(key, fresh('m'));
      },
    });

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
