import traverseModule from '@babel/traverse';
import * as t from '@babel/types';

const traverse = traverseModule.default ?? traverseModule;

function isPureLiteral(node) {
  return (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node) ||
    t.isNullLiteral(node) ||
    (t.isIdentifier(node) && (node.name === 'undefined' || node.name === 'NaN' || node.name === 'Infinity'))
  );
}

/**
 * Propagate pure constant literals and collapse single-assignment variable aliases.
 *
 * Challenge scripts conceal endpoints, tokens, and logic behind multi-hop variable chains:
 *   var a = "https://endpoint/v1";
 *   var b = a;
 *   var c = b;
 *   fetch(c);
 *
 * This pass propagates constant values and aliases directly to their call sites,
 * collapsing decoy chains and removing redundant declarations.
 */
export const propagateConstants = {
  name: 'propagate-constants',
  description: 'Propagate constant literals and collapse single-assignment variable aliases.',
  run(ast, report) {
    let propagated = 0;

    traverse(ast, {
      VariableDeclarator(path) {
        const { id, init } = path.node;
        if (!t.isIdentifier(id) || !init) return;
        if (path.parentPath?.parentPath?.isExportNamedDeclaration()) return;

        const binding = path.scope.getBinding(id.name);
        if (!binding || !binding.constant) return;

        // Case 1: Pure primitive literal
        if (isPureLiteral(init)) {
          if (binding.referencePaths.length === 0) return;
          for (const refPath of [...binding.referencePaths]) {
            refPath.replaceWith(t.cloneNode(init, true));
            propagated++;
          }
          try {
            path.remove();
          } catch {}
          return;
        }

        // Case 2: Pure variable alias
        if (t.isIdentifier(init)) {
          if (binding.referencePaths.length === 0) return;
          const targetBinding = path.scope.getBinding(init.name);
          if (!targetBinding) return;
          // The alias captured the target's VALUE at initialization  -  if the
          // target can be reassigned afterwards, replacing reads of the alias
          // with the target would observe the wrong value.
          if (!targetBinding.constant) return;
          // The target must also already exist at the alias's initialization:
          // `var b = a; var a = 1;` captures undefined, not 1.
          const targetStart = targetBinding.path.node?.start;
          const aliasStart = path.node.start;
          if (typeof targetStart !== 'number' || typeof aliasStart !== 'number' || targetStart > aliasStart) return;

          let safe = true;
          for (const refPath of binding.referencePaths) {
            if (!refPath.scope.hasBinding(init.name) || refPath.scope.getBinding(init.name) !== targetBinding) {
              safe = false;
              break;
            }
          }

          if (safe) {
            for (const refPath of [...binding.referencePaths]) {
              refPath.replaceWith(t.identifier(init.name));
              propagated++;
            }
            try {
              path.remove();
            } catch {}
          }
        }
      },
    });

    report.count(propagated);
    if (propagated > 0) {
      report.note(`propagated ${propagated} constant literal(s) and alias(es)`);
    }
  },
};
