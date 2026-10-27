import assert from 'node:assert';
import { deobfuscate } from '../src/index.js';

console.log('Running disarm core verification suite...\n');

// 1. Control-flow unflattening
{
  const input = [
    'function test() {',
    '  var seq = "2|0|1".split("|"), idx = 0;',
    '  var a = 0;',
    '  while (true) {',
    '    switch (seq[idx++]) {',
    '      case "0": a += 2; continue;',
    '      case "1": return a; continue;',
    '      case "2": a += 1; continue;',
    '    }',
    '    break;',
    '  }',
    '}',
  ].join('\n');
  const { code } = deobfuscate(input);
  assert.ok(code.includes('a += 1;'), 'CFU must contain first step');
  assert.ok(code.includes('a += 2;'), 'CFU must contain second step');
  assert.ok(code.includes('return a;'), 'CFU must contain return');
  assert.ok(!code.includes('switch'), 'CFU must remove switch statement');
  assert.ok(!code.includes('while'), 'CFU must remove while loop');
  console.log('  ok: control-flow unflattening');
}

// 2. Proxy wrapper inlining
{
  const input = [
    'function wrapper(a, b, c) { return target(a - 10, b); }',
    'var res = wrapper(25, 42, 99);',
  ].join('\n');
  const { code } = deobfuscate(input);
  assert.ok(code.includes('target(15, 42)'), 'Proxy wrapper call must be inlined with folded args');
  assert.ok(!code.includes('function wrapper'), 'Dead proxy wrapper must be purged');
  console.log('  ok: proxy function inlining');
}

// 3. Object dictionary inlining
{
  const input = [
    'var dict = {',
    '  "add": function(a, b) { return a + b; },',
    '  "val": "hello"',
    '};',
    'var x = dict.add(10, 20);',
    'var y = dict.val;',
  ].join('\n');
  const { code } = deobfuscate(input);
  assert.ok(code.includes('x = 30;'), 'Dictionary operation must be inlined and folded');
  assert.ok(code.includes('y = "hello";'), 'Dictionary property must be inlined');
  assert.ok(!code.includes('var dict'), 'Dead dictionary must be purged');
  console.log('  ok: object dictionary inlining');
}

// 4. Constant folding and negative arithmetic
{
  const input = 'var a = 10 - 20; var b = -5 * 3; var c = ~0; var d = "val: " + (5 - 10);';
  const { code } = deobfuscate(input);
  assert.ok(code.includes('a = -10;'), 'Negative subtraction must fold');
  assert.ok(code.includes('b = -15;'), 'Negative multiplication must fold');
  assert.ok(code.includes('c = -1;'), 'Bitwise NOT must fold');
  assert.ok(code.includes('d = "val: -5";'), 'Negative string concatenation must fold');
  console.log('  ok: negative arithmetic constant folding');
}

// 5. Coercion tricks
{
  const input = 'var a = !0; var b = !1; var c = ![]; var d = +[]; var e = void 0; var f = [][[]] + "";';
  const { code } = deobfuscate(input);
  assert.ok(code.includes('a = true;'), '!0 must fold to true');
  assert.ok(code.includes('b = false;'), '!1 must fold to false');
  assert.ok(code.includes('c = false;'), '![] must fold to false');
  assert.ok(code.includes('d = 0;'), '+[] must fold to 0');
  assert.ok(code.includes('e = undefined;'), 'void 0 must fold to undefined');
  assert.ok(code.includes('f = "undefined";'), '[][[]] + "" must fold to "undefined"');
  console.log('  ok: coercion trick simplification');
}

// 6. Member normalization
{
  const input = 'var a = obj["default"]; var b = obj["catch"]; var c = obj["prop"];';
  const { code } = deobfuscate(input);
  assert.ok(code.includes('obj.default;'), 'Keyword default must normalize to dot access');
  assert.ok(code.includes('obj.catch;'), 'Keyword catch must normalize to dot access');
  assert.ok(code.includes('obj.prop;'), 'Standard identifier must normalize to dot access');
  console.log('  ok: member normalization with reserved words');
}

// 7. Debugger trap and self-defending neutralization
{
  const input = [
    'function trap() { debugger; }',
    'trap();',
    'Function("debugger")();',
    'var ctrl = (function () {',
    '  var first = true;',
    '  return function (ctx, fn) {',
    '    var r = first ? function () { if (fn) { fn.apply(ctx, arguments); fn = null; } } : function () {};',
    '    first = false;',
    '    return r;',
    '  };',
    '})();',
    'var g = ctrl(this, function () { return "tamper"; });',
    'g();',
    'var keep = 42;',
  ].join('\n');
  const { code } = deobfuscate(input);
  assert.ok(!code.includes('debugger'), 'Debugger statements must be stripped');
  assert.ok(!code.includes('trap()'), 'Trap calls must be stripped');
  assert.ok(!code.includes('"tamper"'), 'Anti-tamper payloads must be neutralized');
  assert.ok(code.includes('keep = 42;'), 'Legitimate code must be preserved');
  console.log('  ok: trap stripping and self-defending neutralization');
}

// 8. Sequence expression splitting
{
  const input = [
    'function run() {',
    '  var x, y;',
    '  (x = 10, y = 20, compute(x + y));',
    '  return x = 30, y = 40, x + y;',
    '}',
  ].join('\n');
  const { code } = deobfuscate(input);
  assert.ok(code.includes('x = 10;'), 'Sequence in expression must split into statement');
  assert.ok(code.includes('compute(x + y);'), 'Sequence call must be separate statement');
  assert.ok(code.includes('return x + y;'), 'Sequence in return must isolate return statement');
  console.log('  ok: sequence expression splitting');
}

// 9. Logical guard unwrapping
{
  const input = [
    'function handle(signal, ready) {',
    '  signal && dispatch(signal);',
    '  !ready || activate();',
    '}',
  ].join('\n');
  const { code } = deobfuscate(input);
  assert.ok(code.includes('if (signal)'), '&& guard must convert to if statement');
  assert.ok(code.includes('dispatch(signal);'), '&& action must be inside block');
  assert.ok(code.includes('if (ready)'), '!ready || guard must convert to if statement');
  assert.ok(code.includes('activate();'), '|| action must be inside block');
  console.log('  ok: logical guard unwrapping');
}

// 10. Constant literal and alias chain propagation
{
  const input = [
    'var baseEndpoint = "https://security.api";',
    'var route = baseEndpoint;',
    'var target = route;',
    'fetch(target);',
  ].join('\n');
  const { code } = deobfuscate(input);
  assert.ok(code.includes('fetch("https://security.api");'), 'Constant alias chain must propagate directly to call site');
  assert.ok(!code.includes('baseEndpoint'), 'Intermediate alias baseEndpoint must be eliminated');
  assert.ok(!code.includes('target'), 'Intermediate alias target must be eliminated');
  console.log('  ok: constant literal and alias chain propagation');
}

// 11. Literal normalization (hex to decimal, escaped chars to strings)
{
  const input = [
    'var count = 0x1f4;',
    'var zero = 0x0;',
    'var greeting = "\\x68\\x65\\x6c\\x6c\\x6f";',
  ].join('\n');
  const { code } = deobfuscate(input);
  assert.ok(code.includes('count = 500;'), 'Hex 0x1f4 must normalize to 500');
  assert.ok(code.includes('zero = 0;'), 'Hex 0x0 must normalize to 0');
  assert.ok(code.includes('greeting = "hello";'), 'Escaped hex string must normalize to "hello"');
  console.log('  ok: literal normalization');
}

// 12. Combined modern challenge reconstruction
{
  const input = [
    'var _0xaddr = "\\x68\\x74\\x74\\x70\\x73\\x3a\\x2f\\x2f\\x63\\x68\\x61\\x6c\\x6c\\x65\\x6e\\x67\\x65\\x2e\\x6c\\x6f\\x63\\x61\\x6c";',
    'var _0xport = 0x1bb;',
    'var _0xdest = _0xaddr;',
    'var _0xactive = !0;',
    'function inspect() { debugger; }',
    'inspect();',
    '_0xactive && sendPing(_0xdest, _0xport);',
  ].join('\n');
  const { code } = deobfuscate(input);
  assert.ok(!code.includes('debugger'), 'Trap must be removed');
  assert.ok(!code.includes('inspect'), 'Trap function must be removed');
  assert.ok(code.includes('sendPing("https://challenge.local", 443);'), 'All constants, strings, and hex numbers must normalize directly into call site');
  assert.ok(!code.includes('if (true)'), 'Truth-decided condition must be unpacked by dead-code elimination');
  console.log('  ok: end-to-end modern challenge reconstruction');
}

// 13. Statement ternary unrolling
{
  const input = [
    'function handle(flag) {',
    '  flag ? (init(), start()) : (retry(), wait());',
    '}',
  ].join('\n');
  const { code } = deobfuscate(input);
  assert.ok(code.includes('if (flag) {'), 'Ternary must convert to if statement');
  assert.ok(code.includes('init();'), 'Consequent must be statements inside block');
  assert.ok(code.includes('start();'), 'Consequent sequence must unroll into block');
  assert.ok(code.includes('} else {'), 'Ternary must have else branch');
  assert.ok(code.includes('retry();'), 'Alternate must be statements inside block');
  console.log('  ok: statement ternary unrolling');
}

// 14. Yoda condition normalization
{
  const input = [
    'function check(status, doc, val) {',
    '  if ("hidden" === doc.visibilityState && 402 === status && 0 < val) {',
    '    return null !== val;',
    '  }',
    '}',
  ].join('\n');
  const { code } = deobfuscate(input);
  assert.ok(code.includes('doc.visibilityState === "hidden"'), 'String literal must flip to right');
  assert.ok(code.includes('status === 402'), 'Number literal must flip to right');
  assert.ok(code.includes('val > 0'), 'Inequality literal must flip and invert operator');
  assert.ok(code.includes('val !== null'), 'Null literal must flip to right');
  console.log('  ok: yoda condition normalization');
}

// 15. Compound variable declaration splitting
{
  const input = [
    'function setup() {',
    '  var a = init(), b = configure(), c = start();',
    '  return a;',
    '}',
  ].join('\n');
  const { code } = deobfuscate(input);
  assert.ok(code.includes('var a = init();'), 'First declarator must be standalone statement');
  assert.ok(code.includes('var b = configure();'), 'Second declarator must be standalone statement');
  assert.ok(code.includes('var c = start();'), 'Third declarator must be standalone statement');
  console.log('  ok: compound variable declaration splitting');
}

console.log('\nAll 15 core verification checks passed successfully.');
