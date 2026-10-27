#!/usr/bin/env node
import fs from 'node:fs';
import { deobfuscate } from './index.js';

function usage() {
  console.log(`disarm: turn hostile JavaScript into readable source

Usage:
  disarm <input.js> [-o output.js] [--report report.json]

Options:
  -o, --output    Write cleaned JavaScript here (default: <input>.clean.js)
  --report        Write the JSON pass report here (default: <output>.report.json)
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

const source = fs.readFileSync(input, 'utf8');
const { code, report } = deobfuscate(source, { sandbox });

output ??= input.replace(/\.js$/i, '') + '.clean.js';
reportPath ??= output.replace(/\.js$/i, '') + '.report.json';

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
