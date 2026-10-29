// Control-flow heavy source for round-trip verification.
function classify(n) {
  if (n % 15 === 0) {
    return "fizzbuzz";
  }
  if (n % 3 === 0) {
    return "fizz";
  }
  if (n % 5 === 0) {
    return "buzz";
  }
  return "" + n;
}
var out = [];
for (var i = 1; i <= 20; i++) {
  out.push(classify(i));
}
var pick = true && "yes";
function unusedHelper() {
  return 1;
}
var skip = false && unusedHelper();
var identity = "nested" + (" " + "strings");
var dict = {
  add: function (a, b) { return a + b; },
  label: "ledger",
};
var sum = dict.add(2, 3) + dict.label.length;
__unmask_result = { out: out, pick: pick, skip: skip, identity: identity, count: out.length, sum: sum };
