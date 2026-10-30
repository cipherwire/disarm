import fs from 'node:fs';
import { parse } from '../src/core/parse.js';
import { print } from '../src/core/print.js';
import { defaultPasses } from '../src/passes/index.js';
import { Report } from '../src/core/report.js';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default ?? traverseModule;

const targetFile = process.argv[2] ?? 'new-test.js';
console.log(`Profiling target: ${targetFile}`);

const code = fs.readFileSync(targetFile, 'utf8');
console.log(`Target size: ${(code.length / 1024 / 1024).toFixed(2)} MB (${code.length} bytes)`);

const tParse0 = performance.now();
const ast = parse(code);
const tParse = performance.now() - tParse0;
console.log(`Parse completed in ${tParse.toFixed(1)} ms`);

const report = new Report();
const timings = [];

for (let i = 0; i < defaultPasses.length; i++) {
  const pass = defaultPasses[i];
  traverse.cache?.clearScope?.();
  report.startPass(pass.name, pass.description ?? '');
  const t0 = performance.now();
  try {
    pass.run(ast, report, { options: {} });
  } catch (err) {
    console.error(`Error in ${pass.name}:`, err.message);
  }
  const dur = performance.now() - t0;
  report.endPass();
  const lastPass = report.passes[report.passes.length - 1];
  timings.push({
    index: i + 1,
    name: pass.name,
    ms: dur,
    changes: lastPass.changes,
  });
  console.log(`[${String(i + 1).padStart(2)}/${defaultPasses.length}] ${pass.name.padEnd(25)} ${dur.toFixed(1).padStart(7)} ms | changes: ${lastPass.changes}`);
}

const tPrint0 = performance.now();
const out = print(ast);
const tPrint = performance.now() - tPrint0;
console.log(`Print completed in ${tPrint.toFixed(1)} ms (output size: ${(out.length / 1024 / 1024).toFixed(2)} MB)`);

timings.sort((a, b) => b.ms - a.ms);
console.log('\n================ TOP 10 SLOWEST PASSES ================');
for (let k = 0; k < Math.min(10, timings.length); k++) {
  const p = timings[k];
  console.log(`${String(k + 1).padStart(2)}. #${String(p.index).padStart(2)} ${p.name.padEnd(25)} : ${p.ms.toFixed(1).padStart(7)} ms (${p.changes} changes)`);
}

const totalPassMs = timings.reduce((acc, x) => acc + x.ms, 0);
console.log('======================================================');
console.log(`Total Passes Time: ${totalPassMs.toFixed(1)} ms`);
console.log(`Total Pipeline Time (parse + passes + print): ${(tParse + totalPassMs + tPrint).toFixed(1)} ms\n`);
