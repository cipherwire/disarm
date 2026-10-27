import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
import { hasLocalBinding } from '../utils/ast.js';

const traverse = traverseModule.default ?? traverseModule;

const PURE_GLOBALS = {
  escape: globalThis.escape,
  unescape: globalThis.unescape,
  decodeURIComponent: globalThis.decodeURIComponent,
  encodeURIComponent: globalThis.encodeURIComponent,
  decodeURI: globalThis.decodeURI,
  encodeURI: globalThis.encodeURI,
  atob: (s) => (typeof globalThis.atob === 'function' ? globalThis.atob(s) : Buffer.from(s, 'base64').toString('binary')),
  btoa: (s) => (typeof globalThis.btoa === 'function' ? globalThis.btoa(s) : Buffer.from(s, 'binary').toString('base64')),
};

/**
 * Fold calls to pure string globals (unescape, atob, btoa, ...) applied to
 * string literals. Skipped when the name has been shadowed locally.
 */
export const foldUnescape = {
  name: 'fold-unescape',
  description: 'Fold unescape/escape/atob/btoa/decodeURIComponent calls on string literals.',
  run(ast, report) {
    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;
        let fnName = null;
        if (t.isIdentifier(callee)) {
          if (!hasLocalBinding(path, callee.name)) fnName = callee.name;
        } else if (
          t.isMemberExpression(callee) &&
          !callee.computed &&
          t.isIdentifier(callee.object) &&
          (callee.object.name === 'window' || callee.object.name === 'globalThis' || callee.object.name === 'self') &&
          t.isIdentifier(callee.property)
        ) {
          fnName = callee.property.name;
        }
        if (!fnName) return;
        const fn = PURE_GLOBALS[fnName];
        if (!fn) return;
        if (path.node.arguments.length !== 1 || !t.isStringLiteral(path.node.arguments[0])) return;

        let output;
        try {
          output = fn(path.node.arguments[0].value);
        } catch {
          return;
        }
        if (typeof output !== 'string') return;

        path.replaceWith(t.stringLiteral(output));
        report.count();
      },
    });
  },
};
