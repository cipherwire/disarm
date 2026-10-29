/**
 * Generates obfuscated fixtures from the clean round-trip sources using
 * javascript-obfuscator — the same engine many real-world packs ship —
 * so every pass can be verified against ground truth (the original source)
 * instead of assumptions. Also emits the demo site.
 *
 * Empirical notes baked into the presets:
 *   - selfDefending corrupts reformatted code by design; the behavior
 *     runner executes only the CLEANED output, which self-verifies the
 *     strip passes (its traps must be gone or the run infinite-loops).
 *   - stringArrayEncoding rc4 silently suppresses the engine's
 *     selfDefending/debugProtection helpers, so rc4 lives in the
 *     `stringarray` preset instead of the gauntlet.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const srcDir = path.join(root, 'test', 'roundtrip');
const outDir = path.join(root, 'test', 'fixtures');
const demoDir = path.join(root, 'test', 'demo-site');

const presets = {
  minified: { compact: true, simplify: false, stringArray: false },
  hexnames: {
    compact: true, simplify: true, identifierNamesGenerator: 'hexadecimal',
    renameGlobals: true, selfDefending: false, stringArray: false,
    numbersToExpressions: false, transformObjectKeys: false, unicodeEscapeSequence: false,
  },
  stringarray: {
    compact: true, simplify: true, identifierNamesGenerator: 'hexadecimal',
    renameGlobals: true, selfDefending: false, stringArray: true,
    stringArrayThreshold: 1, stringArrayShuffle: true, stringArrayRotate: true,
    stringArrayEncoding: ['rc4'],
    splitStrings: false, transformObjectKeys: false, unicodeEscapeSequence: false,
  },
  controlflow: {
    compact: true, simplify: true, identifierNamesGenerator: 'hexadecimal',
    renameGlobals: true, selfDefending: false, stringArray: false,
    controlFlowFlattening: true, controlFlowFlatteningThreshold: 1,
    deadCodeInjection: false, transformObjectKeys: false, unicodeEscapeSequence: false,
  },
  maxhard: {
    compact: true, simplify: true, identifierNamesGenerator: 'hexadecimal',
    renameGlobals: true, selfDefending: true, debugProtection: true, debugProtectionInterval: 2000,
    stringArray: true, stringArrayThreshold: 1, stringArrayShuffle: true, stringArrayRotate: true,
    splitStrings: true, splitStringsChunkLength: 5,
    controlFlowFlattening: true, controlFlowFlatteningThreshold: 1,
    deadCodeInjection: true, deadCodeInjectionThreshold: 1,
    numbersToExpressions: true, unicodeEscapeSequence: false,
    transformObjectKeys: false,
  },
};

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(demoDir, { recursive: true });

const sources = fs.readdirSync(srcDir).filter((file) => file.endsWith('.src.js'));
let written = 0;
for (const file of sources) {
  const code = fs.readFileSync(path.join(srcDir, file), 'utf8');
  const name = path.basename(file, '.src.js');
  for (const [preset, options] of Object.entries(presets)) {
    const obfuscated = JavaScriptObfuscator.obfuscate(code, options).getObfuscatedCode();
    fs.writeFileSync(path.join(outDir, `${name}.${preset}.js`), obfuscated, 'utf8');
    written++;
  }
}
console.log(`wrote ${written} fixtures`);
