#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';
import { spawnSync } from 'node:child_process';
import { deobfuscate, inspectTelemetry, formatInspectionReport } from './index.js';
import { colors } from './utils/colors.js';

function usage() {
  console.log(`disarm: turn hostile JavaScript into readable source

Usage:
  disarm <input.js> [-o output.js] [--report report.json] [--inspect] [--annotate]
  disarm inspect <input.js>

Options:
  -o, --output    Write cleaned JavaScript here (default: output/<basename>.clean.js)
  --report        Write the JSON pass report here (default: output/<basename>.report.json)
  --inspect       Display detected browser fingerprinting probes and endpoints
  --annotate      Inject explanatory comments above neutralized traps
  --no-sandbox    Disable the sandboxed string-bank harvester
  -h, --help      Show this help

Note:
  A file literally named "inspect" must be passed as ./inspect (the bare word
  is treated as the inspection subcommand).
`);
}

/**
 * Print a clean, consumer-facing error and exit. Raw stacks are only shown
 * when DEBUG is set, so failures stay diagnosable without leaking internals
 * to end users.
 */
const fail = (message, error) => {
  console.error(`error: ${message}`);
  if (error && process.env.DEBUG) console.error(error.stack ?? error);
  process.exit(1);
};

const readSource = () => {
  try {
    return isStdin ? fs.readFileSync(0, 'utf8') : fs.readFileSync(input, 'utf8');
  } catch (error) {
    if (error.code === 'EISDIR') fail(`cannot read input: ${input} is a directory`);
    fail(`cannot read input: ${error.message}`, error);
  }
};

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
  usage();
  process.exit(args.length === 0 ? 1 : 0);
}

const positional = [];
let output = null;
let reportPath = null;
let sandbox = true;
let inspectOnly = false;
let showInspect = false;
let annotate = false;

const KNOWN_FLAGS = new Set([
  '-h', '--help', '-o', '--output', '--report', '--inspect', '--annotate', '--no-sandbox',
]);

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case 'inspect':
      inspectOnly = true;
      break;
    case '--inspect':
      showInspect = true;
      break;
    case '--annotate':
      annotate = true;
      break;
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
      // A token that looks like a flag but matches nothing is almost certainly
      // a typo: erroring beats silently treating it as a filename.
      if (args[i].startsWith('-') && args[i] !== '-' && !KNOWN_FLAGS.has(args[i])) {
        console.error(`error: unknown option: ${args[i]}`);
        process.exit(1);
      }
      positional.push(args[i]);
  }
}

const input = positional[0];
if (!input) {
  usage();
  process.exit(1);
}

const isStdin = input === '-';

if (!isStdin && !fs.existsSync(input)) {
  console.error(`error: input file not found: ${input}`);
  process.exit(1);
}

if (inspectOnly) {
  const source = readSource();
  let inspection;
  try {
    inspection = inspectTelemetry(source);
  } catch (error) {
    if (error instanceof SyntaxError) fail(`parse error in ${isStdin ? 'stdin' : input}: ${error.message}`, error);
    if (error instanceof RangeError) fail(`cannot inspect ${isStdin ? 'stdin' : input}: input is too deeply nested or too complex`, error);
    fail(`inspection failed: ${error.message}`, error);
  }
  console.log(formatInspectionReport(inspection));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Auto-scale V8 memory limit under the hood for large files (>= 2.5 MB)
// ---------------------------------------------------------------------------
if (!isStdin) {
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
}

const showProgress = Boolean(process.stderr.isTTY && !process.env.CI);

const onProgress = (current, total, passName) => {
  if (!showProgress) return;
  const percent = Math.round((current / total) * 100);
  const width = 14;
  const filled = Math.round((percent / 100) * width);
  const bar = '='.repeat(filled) + (filled < width ? '>' : '') + ' '.repeat(Math.max(0, width - filled - (filled < width ? 1 : 0)));
  process.stderr.write(
    `\r${colors.dim('[')}${colors.cyan(String(current).padStart(2))}/${colors.cyan(total)}${colors.dim(']')} ` +
    `${colors.yellow(`[${bar}]`)} ${colors.bold(colors.brightGreen(`${percent}%`))} ` +
    `${colors.white(passName.padEnd(24))}`
  );
};

const source = readSource();

if (showProgress) {
  process.stderr.write(`${colors.dim('[disarm]')} running deobfuscation pipeline...\n`);
}

let deobfuscation;
try {
  deobfuscation = deobfuscate(source, { sandbox, annotate, onProgress });
} catch (error) {
  if (error instanceof SyntaxError) fail(`parse error in ${isStdin ? 'stdin' : input}: ${error.message}`, error);
  if (error instanceof RangeError) fail(`cannot process ${isStdin ? 'stdin' : input}: input is too deeply nested or too complex`, error);
  fail(`deobfuscation failed: ${error.message}`, error);
}
const { code, report } = deobfuscation;

if (showProgress) {
  process.stderr.write('\r\x1b[2K\r');
}

if (isStdin && !output) {
  process.stdout.write(code + '\n');
  if (reportPath) {
    try {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, JSON.stringify(report.toJSON(), null, 2), 'utf8');
    } catch (error) {
      fail(`cannot write report: ${error.message}`, error);
    }
  }
  process.exit(0);
}

const baseName = path.basename(input).replace(/\.js$/i, '');
const defaultOutputDir = 'output';

output ??= path.join(defaultOutputDir, `${baseName}.clean.js`);
reportPath ??= path.join(defaultOutputDir, `${baseName}.report.json`);

try {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(output, code, 'utf8');
  fs.writeFileSync(reportPath, JSON.stringify(report.toJSON(), null, 2), 'utf8');
} catch (error) {
  fail(`cannot write output: ${error.message}`, error);
}

console.log(`${colors.dim('input    ')} ${colors.white(input)}`);
console.log(`${colors.dim('output   ')} ${colors.green(output)}`);
console.log(`${colors.dim('report   ')} ${colors.cyan(reportPath)}`);
console.log(`${colors.dim('changes  ')} ${colors.bold(colors.brightGreen(report.totalChanges()))} across ${report.passes.length} passes`);

if (report.telemetry) {
  const t = report.telemetry;
  const scoreColor = t.readabilityScore >= 70 ? colors.brightGreen : (t.readabilityScore >= 45 ? colors.brightYellow : colors.brightRed);
  console.log(`${colors.dim('metrics  ')} complexity: ${colors.yellow(t.initial.cyclomatic)} -> ${colors.green(t.final.cyclomatic)} (${colors.green(`-${t.cyclomaticDrop}%`)}) | AST nodes: ${colors.yellow(t.initial.nodeCount)} -> ${colors.green(t.final.nodeCount)} | score: ${scoreColor(colors.bold(`${t.readabilityScore}/100`))}`);
}

for (const pass of report.passes) {
  if (pass.changes > 0) {
    console.log(`  ${colors.dim('->')} ${colors.cyan(pass.name.padEnd(24))} ${colors.bold(colors.brightYellow(pass.changes))}`);
  }
}

for (const warning of report.warnings) {
  console.log(`${colors.brightRed('warning  ')} ${colors.yellow(warning)}`);
}

if (showInspect && report.meta.inspection) {
  console.log('\n' + formatInspectionReport(report.meta.inspection));
}
