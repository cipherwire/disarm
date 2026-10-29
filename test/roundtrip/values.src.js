// Deterministic value pipeline used for round-trip verification.
// The fixtures generator obfuscates this file with javascript-obfuscator;
// the behavior runner then asserts that deobfuscated output computes the
// exact same __unmask_result as this original source.
var greeting = "hello" + " " + "world";
var radix = Number(343388).toString(25);
var trick = [][[]] + "";
var masked = unescape("hello%20unmask");
var product = 6 * 7;
var flag = ![];
var combined = "a" + 1 + true;
var neg = 0 - 5;
var typed = typeof "unmask";
var longChain = 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10;
__unmask_result = {
  greeting: greeting,
  radix: radix,
  trick: trick,
  masked: masked,
  product: product,
  flag: flag,
  combined: combined,
  neg: neg,
  typed: typed,
  longChain: longChain,
};
