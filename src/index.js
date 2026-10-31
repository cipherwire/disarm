import { parse } from './core/parse.js';
import { print } from './core/print.js';
import { runPasses } from './core/pipeline.js';
import { Report } from './core/report.js';
import { measureComplexity, compareTelemetry } from './core/telemetry.js';
import { inspectTelemetry, formatInspectionReport } from './core/inspector.js';
import { defaultPasses } from './passes/index.js';

/**
 * Deobfuscate JavaScript source code.
 *
 * Returns { code, report, ast }: the cleaned source, an auditable report of
 * every pass, and the final AST for programmatic consumers.
 *
 * Options:
 *   sandbox   : enable the sandboxed string-bank harvester (default: true)
 *   telemetry : compute structural complexity and readability delta (default: true)
 *   passes    : custom pass list (default: the full ordered pipeline)
 */
export function deobfuscate(code, options = {}) {
  const { passes = defaultPasses, telemetry = true, onProgress, ...rest } = options;
  const ast = parse(code);
  const report = new Report();

  const initialMetrics = telemetry ? measureComplexity(ast) : null;
  runPasses(ast, passes, report, { options: rest, onProgress, source: code });

  if (telemetry && initialMetrics) {
    const finalMetrics = measureComplexity(ast);
    report.setTelemetry(compareTelemetry(initialMetrics, finalMetrics));
  }

  // Record detected fingerprinting probes and endpoints on the clean AST
  report.meta.inspection = inspectTelemetry(ast);

  return { code: print(ast), report, ast };
}

export { inspectTelemetry, formatInspectionReport };
export default deobfuscate;
