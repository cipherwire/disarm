import { Report } from './report.js';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default ?? traverseModule;

/**
 * Run each pass over the AST in order. A failing pass never kills the
 * pipeline: it logs a warning and the remaining passes still run.
 * Babel's scope cache is cleared between passes because earlier passes
 * mutate the tree and stale caches are how traversal re-enters itself.
 */
export function runPasses(ast, passes, report = new Report(), context = { options: {} }) {
  const total = passes.length;
  for (let i = 0; i < total; i++) {
    const pass = passes[i];
    context?.onProgress?.(i + 1, total, pass.name);
    traverse.cache?.clearScope?.();
    report.startPass(pass.name, pass.description ?? '');
    try {
      pass.run(ast, report, context);
    } catch (error) {
      report.warn(`pass "${pass.name}" failed: ${error.message}`);
    }
    report.endPass();
  }
  return report;
}
