import generateModule from '@babel/generator';

const generate = generateModule.default ?? generateModule;

/**
 * Print an AST back to source. Babel's generator wraps at 80 columns and
 * keeps comments, which is our baseline "readable" formatting.
 */
export function print(ast) {
  return generate(ast, {
    comments: true,
    jsescOption: { minimal: true },
  }).code;
}
