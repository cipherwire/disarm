import { parse } from './core/parse.js';
import { print } from './core/print.js';
import { runPasses } from './core/pipeline.js';
import { Report } from './core/report.js';
import { defaultPasses } from './passes/index.js';

/**
 * Deobfuscate JavaScript source code.
 *
 * Returns { code, report, ast }: the cleaned source, an auditable report of
 * every pass, and the final AST for programmatic consumers.
 *
 * Options:
 *   sandbox  :  enable the sandboxed string-bank harvester (default: true)
 *   passes   :  custom pass list (default: the full ordered pipeline)
 */
export function deobfuscate(code, options = {}) {
  const { passes = defaultPasses, ...rest } = options;
  const ast = parse(code);
  const report = new Report();
  runPasses(ast, passes, report, { options: rest });
  return { code: print(ast), report, ast };
}

export default deobfuscate;
