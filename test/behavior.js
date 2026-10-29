/**
 * Behavior verification  -  the layer that catches what string assertions
 * cannot. Three sections:
 *   1. round-trip: obfuscated fixtures (javascript-obfuscator presets incl.
 *      the maxhard gauntlet) must compute the same __unmask_result after
 *      deobfuscation as the original clean source. The obfuscated form is
 *      never executed (its debug traps would loop); only the CLEANED output
 *      runs, so the strip passes are self-verified end to end.
 *   2. real samples: the ThreatMetrix dynamic script must surface its
 *      hidden literals; the real obfuscator.io sample must process safely.
 *   3. gauntlet manifest: technique fingerprinting must fire on maxhard.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import url from 'node:url';
import { deobfuscate } from '../src/index.js';
import { makeStubs } from '../src/utils/stubs.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`  ok    ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`  FAIL  ${name}\n        ${error.message.split('\n')[0]}`);
  }
}

const runInSandbox = (code) => {
  const sandbox = { ...makeStubs() };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 8000 });
  return vm.runInContext('__unmask_result', sandbox, { timeout: 2000 });
};
const normalize = (value) => JSON.parse(JSON.stringify(value ?? null));

// 1. round-trips ---------------------------------------------------------------
console.log('\nround-trip (behavior must be identical to the clean source)');
const fixturesDir = path.join(root, 'test', 'fixtures');
const fixtures = fs.existsSync(fixturesDir)
  ? fs.readdirSync(fixturesDir).filter((file) => file.endsWith('.js'))
  : [];
if (fixtures.length === 0) {
  console.log('  (no fixtures found  -  run `npm run fixtures` first)');
}
for (const file of fixtures) {
  check(`round-trip: ${file}`, () => {
    const srcName = file.split('.')[0];
    const original = runInSandbox(fs.readFileSync(path.join(root, 'test', 'roundtrip', `${srcName}.src.js`), 'utf8'));
    const fixture = fs.readFileSync(path.join(fixturesDir, file), 'utf8');
    const { code } = deobfuscate(fixture);
    const cleaned = runInSandbox(code);
    assert.deepStrictEqual(normalize(cleaned), normalize(original));
  });
}

// 2. real samples ---------------------------------------------------------------
console.log('\nreal samples');
check('real: ThreatMetrix dynamic script surfaces its hidden strings', () => {
  const samplePath = path.join(root, 'samples', 'tmx-dynamic.js');
  assert.ok(fs.existsSync(samplePath), 'samples/tmx-dynamic.js missing');
  const { code, report } = deobfuscate(fs.readFileSync(samplePath, 'utf8'));
  for (const fragment of ['load', 'onload', 'iframe', 'about:blank', 'tmx_tags_iframe', 'WebkitAppearance']) {
    assert.ok(code.includes(`"${fragment}"`), `expected literal "${fragment}" in output`);
  }
  const decoded = report.passes.find((pass) => pass.name === 'decode-string-banks');
  assert.ok(decoded && decoded.changes > 100, `expected heavy bank decoding, got ${decoded?.changes}`);
});

check('real: obfuscator.io sample from the wild processes safely', () => {
  const samplePath = path.join(root, 'samples', 'realworld', 'obfuscator-io-source.js');
  assert.ok(fs.existsSync(samplePath), 'realworld sample missing');
  const { code, report } = deobfuscate(fs.readFileSync(samplePath, 'utf8'));
  assert.ok(code.length > 0);
  assert.ok(!report.warnings.some((w) => w.includes('failed')), 'no pass may hard-fail');
  // Behavior-safe: the cleaned sample must execute without throwing.
  const sandbox = { ...makeStubs() };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 5000 });
});

// 3. gauntlet manifest -----------------------------------------------------------
console.log('\ngauntlet manifest');
check('manifest: maxhard fixture fingerprints the gauntlet techniques', () => {
  const gauntlet = path.join(fixturesDir, 'logic.maxhard.js');
  assert.ok(fs.existsSync(gauntlet), 'logic.maxhard.js missing  -  run `npm run fixtures`');
  const { report } = deobfuscate(fs.readFileSync(gauntlet, 'utf8'));
  const names = new Set((report.meta.techniques ?? []).map((entry) => entry.name));
  for (const expected of ['string-array-literal', 'junk-identifier', 'call-controller-shape']) {
    assert.ok(names.has(expected), `expected technique "${expected}"; got: ${[...names].join(', ')}`);
  }
});

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} behavior checks passed`);
process.exit(failed > 0 ? 1 : 0);
