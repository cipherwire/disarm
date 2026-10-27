import traverseModule from '@babel/traverse';

const traverse = traverseModule.default ?? traverseModule;

/**
 * Normalize hexadecimal numbers and escaped unicode/hex strings to standard format.
 *
 * Obfuscators encode ordinary numbers and characters into obscure representations:
 *   0x1f4 -> 500
 *   0x0   -> 0
 *   "\x68\x65\x6c\x6c\x6f" -> "hello"
 *
 * Stripping Babel AST extra.raw metadata allows the code generator to print
 * clean, readable decimal numbers and unescaped characters.
 */
export const normalizeLiterals = {
  name: 'normalize-literals',
  description: 'Normalize hexadecimal numbers and escaped characters into clean literals.',
  run(ast, report) {
    let normalized = 0;

    traverse(ast, {
      NumericLiteral(path) {
        if (path.node.extra) {
          delete path.node.extra;
          normalized++;
        }
      },
      StringLiteral(path) {
        if (
          path.node.extra &&
          (path.node.extra.raw?.includes('\\x') || path.node.extra.raw?.includes('\\u'))
        ) {
          delete path.node.extra;
          normalized++;
        }
      },
    });

    report.count(normalized);
    if (normalized > 0) {
      report.note(`normalized ${normalized} hexadecimal or escaped literal(s)`);
    }
  },
};
