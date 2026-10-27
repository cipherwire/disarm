import parser from '@babel/parser';

/**
 * Parse JavaScript source into a Babel AST.
 * `errorRecovery` lets us work with slightly malformed challenge scripts
 * instead of refusing them outright.
 */
export function parse(code) {
  return parser.parse(code, {
    sourceType: 'script',
    allowReturnOutsideFunction: true,
    errorRecovery: true,
  });
}
