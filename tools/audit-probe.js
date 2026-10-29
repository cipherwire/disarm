/**
 * Temporary audit probe  -  tests each SUSPECTED bug empirically before fixing.
 * Every probe prints EVIDENCE (executed behavior or generated output), not theory.
 */
import { deobfuscate } from '../src/index.js';
import vm from 'node:vm';

function run(code) {
  const sandbox = { console: { log: () => {} }, result: undefined };
  vm.createContext(sandbox);
  try {
    vm.runInContext(code, sandbox, { timeout: 2000 });
    return { ok: true, result: sandbox.result };
  } catch (error) {
    return { ok: false, error: error.message.split('\n')[0] };
  }
}

function check(label, fn) {
  try {
    const verdict = fn();
    console.log(`${verdict ? 'BUG   ' : 'clean '} ${label}`);
    if (verdict) failures++;
    return verdict;
  } catch (error) {
    console.log(`ERROR  ${label}: ${error.message.split('\n')[0]}`);
    failures++;
    return true;
  }
}

let failures = 0;

// B1: inline-proxies duplicates impure args when a param is used more than once
check('B1 inline-proxies: impure arg duplicated (param used twice)', () => {
  const src = `
    var calls = 0;
    function getValue() { calls += 1; return 5; }
    function square(x) { return x * x; }
    var r = square(getValue());
    result = r + ":" + calls;
  `;
  const original = run(src);
  const { code } = deobfuscate(src);
  const cleaned = run(code);
  console.log(`        original=${JSON.stringify(original.result)} cleaned=${JSON.stringify(cleaned.result)}`);
  return JSON.stringify(original.result) !== JSON.stringify(cleaned.result);
});

// B2: inline-proxies flips evaluation order of two impure args
check('B2 inline-proxies: impure arg evaluation order flipped', () => {
  const src = `
    var order = "";
    function a() { order += "A"; return 1; }
    function b() { order += "B"; return 2; }
    function pair(x, y) { return y + x; }
    var r = pair(a(), b());
    result = r + ":" + order;
  `;
  const original = run(src);
  const { code } = deobfuscate(src);
  const cleaned = run(code);
  console.log(`        original=${JSON.stringify(original.result)} cleaned=${JSON.stringify(cleaned.result)}`);
  return JSON.stringify(original.result) !== JSON.stringify(cleaned.result);
});

// B3: propagate-constants aliases a variable that is reassigned later
check('B3 propagate-constants: alias propagates stale value (target reassigned)', () => {
  const src = `
    var a = 1;
    var b = a;
    a = 2;
    result = b;
  `;
  const original = run(src);
  const { code } = deobfuscate(src);
  const cleaned = run(code);
  console.log(`        original=${JSON.stringify(original.result)} cleaned=${JSON.stringify(cleaned.result)}`);
  return JSON.stringify(original.result) !== JSON.stringify(cleaned.result);
});

// B4: unflatten leaves nested break/continue -> invalid code
check('B4 unflatten-control-flow: nested break becomes illegal statement', () => {
  const src = `
    function run() {
      var seq = "1|0".split("|"), idx = 0;
      var acc = 0;
      while (true) {
        switch (seq[idx++]) {
          case "0": acc += 1; continue;
          case "1": if (acc > 100) { break; } acc += 5; continue;
        }
        break;
      }
      return acc;
    }
    result = run();
  `;
  const original = run(src);
  const { code } = deobfuscate(src);
  const cleaned = run(code);
  console.log(`        original=${JSON.stringify(original.result)} cleaned=${cleaned.ok ? JSON.stringify(cleaned.result) : 'THREW: ' + cleaned.error}`);
  return JSON.stringify(original.result) !== JSON.stringify(cleaned.result) || !cleaned.ok;
});

// B5: declarator removal leaves an invalid empty `var;` statement
check('B5 propagate-constants/unflatten: empty `var;` left in output', () => {
  const src = 'var a = 1; var r = a + 1; result = r;';
  const { code } = deobfuscate(src);
  const bad = /(^|\n)\s*var\s*;/.test(code);
  console.log(`        output contains bare "var;": ${bad}\n        output: ${code.replace(/\n/g, ' | ').slice(0, 160)}`);
  return bad;
});

// B6: fold-constants needs chain climbing for long constant chains
check('B6 long constant chain fully folds and propagates', () => {
  const terms = Array.from({ length: 60 }, (_, i) => i + 1).join(' + ');
  const src = `var r = ${terms}; result = r;`;
  const { code } = deobfuscate(src);
  const fullyFolded = /1830/.test(code) && !/\b[1-9]\d*\s*\+/.test(code);
  console.log(`        fully folded to 1830: ${fullyFolded}\n        output: ${code.replace(/\n/g, ' | ').slice(0, 120)}`);
  return !fullyFolded;
});

// B7: inline-proxies corrupts object shorthand when substituting params
check('B7 inline-proxies: shorthand object property corrupted on substitution', () => {
  const src = `
    var marker = "M";
    function wrap(v) { return { tag: "t", v: v }; }
    var out = wrap(marker);
    result = out.v;
  `;
  const original = run(src);
  const { code } = deobfuscate(src);
  const cleaned = run(code);
  const shorthandBug = /\{\s*tag:\s*"t",\s*v:/.test(code) === false && code.includes('tag:');
  console.log(`        original=${JSON.stringify(original.result)} cleaned=${cleaned.ok ? JSON.stringify(cleaned.result) : 'THREW'}`);
  return JSON.stringify(original.result) !== JSON.stringify(cleaned.result) || !cleaned.ok;
});

console.log(failures === 0 ? '\nAll audit probes clean.' : '\n' + failures + ' audit probe(s) FAILED');
process.exit(failures > 0 ? 1 : 0);
