#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { spawnSync } from 'node:child_process';
import { deobfuscate } from './index.js';

function usage() {
  console.log(`disarm: turn hostile JavaScript into readable source

Usage:
  disarm <input.js> [-o output.js] [--report report.json]

Options:
  -o, --output    Write cleaned JavaScript here (default: output/<basename>.clean.js)
  --report        Write the JSON pass report here (default: output/<basename>.report.json)
  --no-sandbox    Disable the sandboxed string-bank harvester
  -h, --help      Show this help
`);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}

const positional = [];
let output = null;
let reportPath = null;
let sandbox = true;
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '-o':
    case '--output':
      output = args[++i];
      break;
    case '--report':
      reportPath = args[++i];
      break;
    case '--no-sandbox':
      sandbox = false;
      break;
    default:
      positional.push(args[i]);
  }
}

const input = positional[0];
if (!input) {
  usage();
  process.exit(1);
}

if (!fs.existsSync(input)) {
  console.error(`error: input file not found: ${input}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Auto-scale V8 memory limit under the hood for large files (>= 2.5 MB)
// ---------------------------------------------------------------------------
const stat = fs.statSync(input);
const sizeMB = stat.size / (1024 * 1024);
const heapLimitBytes = v8.getHeapStatistics().heap_size_limit;
const heapLimitMB = Math.round(heapLimitBytes / (1024 * 1024));

if (sizeMB >= 2.5 && heapLimitMB < 3800 && process.env.__DISARM_AUTOSCALED !== '1') {
  console.log(`[disarm] large input detected (${sizeMB.toFixed(1)} MB): auto-scaling V8 memory limit to 4096 MB...`);
  const child = spawnSync(
    process.execPath,
    ['--max-old-space-size=4096', ...process.argv.slice(1)],
    {
      stdio: 'inherit',
      env: { ...process.env, __DISARM_AUTOSCALED: '1' },
    },
  );
  process.exit(child.status ?? 0);
}

const source = fs.readFileSync(input, 'utf8');
const { code, report } = deobfuscate(source, { sandbox });

const baseName = path.basename(input).replace(/\.js$/i, '');
const defaultOutputDir = 'output';

output ??= path.join(defaultOutputDir, `${baseName}.clean.js`);
reportPath ??= path.join(defaultOutputDir, `${baseName}.report.json`);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(path.dirname(reportPath), { recursive: true });

fs.writeFileSync(output, code, 'utf8');
fs.writeFileSync(reportPath, JSON.stringify(report.toJSON(), null, 2), 'utf8');

console.log(`input     ${input}`);
console.log(`output    ${output}`);
console.log(`report    ${reportPath}`);
console.log(`changes   ${report.totalChanges()} across ${report.passes.length} passes`);
for (const pass of report.passes) {
  if (pass.changes > 0) console.log(`  ${pass.name.padEnd(24)} ${pass.changes}`);
}
for (const warning of report.warnings) console.log(`warning   ${warning}`);
