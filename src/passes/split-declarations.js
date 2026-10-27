import traverseModule from '@babel/traverse';
import * as t from '@babel/types';

const traverse = traverseModule.default ?? traverseModule;

function isSplitSafeParent(path) {
  const parent = path.parentPath;
  if (!parent) return false;
  // Safe in block statements and top-level program bodies
  if (parent.isBlockStatement() || parent.isProgram()) return true;
  // If parent is an if-statement or loop without braces, wrap in a block first
  if (parent.isIfStatement() || (parent.isLoop() && !parent.isForStatement())) {
    path.replaceWith(t.blockStatement([t.cloneNode(path.node, true)]));
    return false;
  }
  return false;
}

/**
 * Split compound multi-variable declarations into clean individual statements.
 *
 * Obfuscators bundle dozens of variables into a single line:
 *   var a = 1, b = new Set(), c = "https://endpoint.api";
 *
 * Splitting them into distinct statements isolates variable lifetimes and enables
 * subsequent constant propagation and dead code elimination to prune individual declarations.
 */
export const splitDeclarations = {
  name: 'split-declarations',
  description: 'Split compound multi-variable declarations into separate statements.',
  run(ast, report) {
    let splitCount = 0;

    traverse(ast, {
      VariableDeclaration(path) {
        const { kind, declarations } = path.node;
        if (declarations.length <= 1) return;
        if (!isSplitSafeParent(path)) return;

        const statements = declarations.map((decl) =>
          t.variableDeclaration(kind, [t.cloneNode(decl, true)]),
        );

        path.replaceWithMultiple(statements);
        splitCount += declarations.length - 1;
      },
    });

    report.count(splitCount);
    if (splitCount > 0) {
      report.note(`split ${splitCount} compound variable declaration(s) into distinct statements`);
    }
  },
};
