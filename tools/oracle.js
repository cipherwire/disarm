import assert from 'node:assert';
import vm from 'node:vm';
import { deobfuscate } from '../src/index.js';

console.log('Running disarm differential semantic oracle suite...\n');

/**
 * Execute code inside a hardened, isolated sandbox and capture outputs.
 */
function executeInSandbox(code) {
  const logs = [];
  const sandbox = {
    console: {
      log: (...args) => logs.push(args.join(' ')),
      warn: (...args) => logs.push(args.join(' ')),
      error: (...args) => logs.push(args.join(' ')),
    },
    Math,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Date,
    RegExp,
    parseInt,
    parseFloat,
    result: undefined,
  };

  const context = vm.createContext(sandbox);
  try {
    vm.runInContext(code, context, { timeout: 2000 });
  } catch (error) {
    return { error: error.message, logs, result: sandbox.result };
  }

  return { error: null, logs, result: sandbox.result };
}

/**
 * Assert that original code and cleaned code produce identical execution traces.
 */
function assertDifferentialEquivalence(label, originalSource) {
  const { code: cleanedSource } = deobfuscate(originalSource);

  const originalTrace = executeInSandbox(originalSource);
  const cleanedTrace = executeInSandbox(cleanedSource);

  assert.strictEqual(
    cleanedTrace.error,
    originalTrace.error,
    `[${label}] Error state mismatch: original "${originalTrace.error}" vs cleaned "${cleanedTrace.error}"`
  );

  assert.deepStrictEqual(
    cleanedTrace.result,
    originalTrace.result,
    `[${label}] Execution result mismatch: original ${JSON.stringify(originalTrace.result)} vs cleaned ${JSON.stringify(cleanedTrace.result)}`
  );

  assert.deepStrictEqual(
    cleanedTrace.logs,
    originalTrace.logs,
    `[${label}] Console log trace mismatch`
  );

  console.log(`  ok: ${label} (0 semantic drift)`);
}

// Suite 1: Arithmetic, string splitting and literal logic
assertDifferentialEquivalence(
  'arithmetic and split string evaluation',
  [
    'var prefix = "anti" + "bot";',
    'var factor = 20 * 2 + 2;',
    'var greeting = prefix + "_" + factor;',
    'result = greeting;',
  ].join('\n')
);

// Suite 2: State-machine dispatch reconstruction
assertDifferentialEquivalence(
  'state machine control flow execution',
  [
    'function runAlgorithm() {',
    '  var seq = "2|0|1".split("|"), idx = 0;',
    '  var accumulator = 0;',
    '  while (true) {',
    '    switch (seq[idx++]) {',
    '      case "0": accumulator += 50; continue;',
    '      case "1": return accumulator * 2; continue;',
    '      case "2": accumulator += 10; continue;',
    '    }',
    '    break;',
    '  }',
    '}',
    'result = runAlgorithm();',
  ].join('\n')
);

// Suite 3: Function proxy and dictionary inlining
assertDifferentialEquivalence(
  'proxy call and dictionary resolution',
  [
    'var dict = {',
    '  add: function(a, b) { return a + b; },',
    '  sub: function(a, b) { return a - b; }',
    '};',
    'function proxy(fn, x, y) { return fn(x, y); }',
    'var r1 = proxy(dict.add, 100, 25);',
    'var r2 = proxy(dict.sub, r1, 15);',
    'result = r2;',
  ].join('\n')
);

// Suite 4: Yoda conditions and logical guard branches
assertDifferentialEquivalence(
  'conditional guards and branch execution',
  [
    'var active = true;',
    'var count = 5;',
    'var status = "ready";',
    'var output = [];',
    'if ("ready" === status && 5 <= count) {',
    '  output.push("validated");',
    '}',
    'active && output.push("proceed");',
    'result = output.join(":");',
  ].join('\n')
);

// Suite 5: Fibonacci algorithm under variable mangling and compound declarations
assertDifferentialEquivalence(
  'mangled iterative fibonacci algorithm',
  [
    'function fib(n) {',
    '  var a = 0, b = 1, i = 0;',
    '  while (i < n) {',
    '    var next = a + b;',
    '    a = b;',
    '    b = next;',
    '    i = i + 1;',
    '  }',
    '  return a;',
    '}',
    'result = fib(10);',
  ].join('\n')
);

console.log('\nAll differential oracle test suites passed with 0 semantic divergence.');
