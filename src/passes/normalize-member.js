import traverseModule from '@babel/traverse';
import * as t from '@babel/types';

const traverse = traverseModule.default ?? traverseModule;

/**
 * Rewrite `a["prop"]` into `a.prop` when the string is a valid identifier,
 * so decoded strings surface as normal property access.
 */
export const normalizeMember = {
  name: 'normalize-member',
  description: 'Rewrite a["prop"] into a.prop when "prop" is a valid identifier name.',
  run(ast, report) {
    traverse(ast, {
      'MemberExpression|OptionalMemberExpression'(path) {
        const node = path.node;
        if (!node.computed || !t.isStringLiteral(node.property)) return;
        // The second argument `false` allows reserved words (e.g. obj.default, obj.catch)
        if (!t.isValidIdentifier(node.property.value, false)) return;
        node.property = t.identifier(node.property.value);
        node.computed = false;
        report.count();
      },
    });
  },
};
