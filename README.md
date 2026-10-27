<div align="center">

# disarm

**Turn hostile anti-bot challenge scripts into readable JavaScript.**

De-flatten control flow, inline operation proxies, harvest isolated string banks, unwrap sequence expressions, and neutralize anti-tamper logic across commercial bot protection systems.

<p>
  <a href="https://github.com/cipherwire/disarm/actions"><img src="https://img.shields.io/github/actions/workflow/status/cipherwire/disarm/ci.yml?branch=main&label=CI&style=flat-square" alt="CI" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-blue?style=flat-square" alt="Node.js" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" /></a>
  <a href="https://github.com/cipherwire/disarm"><img src="https://img.shields.io/badge/pipeline-30%20passes-purple?style=flat-square" alt="Passes" /></a>
</p>

</div>

---

## Table of Contents

- [Overview](#overview)
- [Target Coverage](#target-coverage)
- [Architecture Pipeline](#architecture-pipeline)
- [Installation & Quick Start](#installation--quick-start)
  - [Command Line](#command-line)
  - [Programmatic API](#programmatic-api)
- [Deobfuscation Engine](#deobfuscation-engine)
  - [1. Control-Flow Unflattening](#1-control-flow-unflattening)
  - [2. Proxy Function & Dictionary Inlining](#2-proxy-function--dictionary-inlining)
  - [3. Isolated String-Bank Harvester](#3-isolated-string-bank-harvester)
  - [4. Fixpoint Constant Folding](#4-fixpoint-constant-folding)
  - [5. Anti-Tamper & Trap Neutralization](#5-anti-tamper--trap-neutralization)
  - [6. Comma Sequence Splitting](#6-comma-sequence-splitting)
  - [7. Logical Guard Unwrapping](#7-logical-guard-unwrapping)
  - [8. Multi-Hop Constant & Alias Propagation](#8-multi-hop-constant--alias-propagation)
  - [9. Literal & Character Normalization](#9-literal--character-normalization)
  - [10. Statement Ternary Unrolling](#10-statement-ternary-unrolling)
  - [11. Yoda Condition Normalization](#11-yoda-condition-normalization)
  - [12. Compound Declaration Splitting](#12-compound-declaration-splitting)
- [CLI Reference](#cli-reference)
- [Verification & CI](#verification--ci)
- [License](#license)

---

## Overview

Enterprise anti-bot challenge scripts (Akamai Bot Manager, Cloudflare Turnstile, DataDome, Shape Security, Kasada, ThreatMetrix) conceal their browser fingerprinting and telemetry algorithms behind layers of obfuscation:

- **State-machine dispatch loops** that shatter linear code into scrambled `switch-case` blocks.
- **Proxy wrapper functions and object dictionaries** that disguise function calls, property lookups, and basic arithmetic.
- **Encrypted string banks** protected by dynamic index rotators, XOR masks, and self-modifying decoders.
- **Short-circuit guard chains and comma expressions** that compress procedural algorithms into dense one-liners.
- **Statement-level nested ternaries** that obscure procedural branches and execution flow.
- **Inverted Yoda conditions** that prevent pattern matching and signature detection.
- **Multi-hop variable alias chains** that scatter endpoint strings and identifiers across decoy declarations.
- **Anti-analysis tripwires** (debugger statements, infinite loops, and prototype tamper checks) that punish inspection.

**disarm** executes a multi-stage Abstract Syntax Tree (AST) pipeline coupled with a hardened V8 sandbox to systematically peel back each layer, producing clean, formatted, and auditable JavaScript.

---

## Target Coverage

| Defense System | Key Obfuscation Vectors | Disarm Deobfuscation Approach |
|---|---|---|
| **Akamai Bot Manager** | Sensor data telemetry, heavy array rotation, switch dispatchers | Dynamic string harvesting, unflattening, math folding |
| **Cloudflare Turnstile** | `/challenge-platform/` orchestrator, opaque predicates, dispatch loops | State-machine reconstruction, proxy inlining, dead branch culling |
| **DataDome** | Rotated AST transforms, wrapper chains, dynamic evaluation | Multi-hop proxy inlining, decoder sandbox isolation |
| **Kasada** | Virtual machine bytecodes, comma sequence chaining, hex literals | Comma sequence splitting, hex normalization, constant folding |
| **ThreatMetrix (TMX)** | Instance string decoders, radix encodings, guarded calls | Class-based bank harvesting, radix conversion folding |
| **obfuscator.io / Commercial** | Self-defending controllers, dead code injection, hex names | Controller neutralization, identifier re-scoping, dead code sweep |

---

## Architecture Pipeline

```
                             Hostile Input Source
                                      │
                                      ▼
                             [ Babel AST Parser ]
                         (script mode, error recovery)
                                      │
 ┌────────────────────────────────────┴────────────────────────────────────┐
 │                                                                         │
 │  Stage 1: Fingerprint & Sequence Pre-processing                         │
 │  ├── 01. detect-techniques      Fingerprint obfuscation techniques      │
 │  ├── 02. split-sequences        Unwrap comma operators into statements  │
 │  ├── 03. split-declarations     Split compound variable declarations    │
 │  ├── 04. strip-debug-traps      Purge debugger statements & trap ctors  │
 │  └── 05. strip-self-defending   Neutralize single-call anti-tamper      │
 │                                                                         │
 │  Stage 2: Structural Unravelling                                        │
 │  ├── 06. inline-proxies         Inline wrapper functions & dictionaries │
 │  ├── 07. unflatten-control-flow Reconstruct linear code from switches   │
 │  ├── 08. unwrap-logical-guards  Convert && and || chains to if-blocks   │
 │  └── 09. unwrap-ternaries       Convert statement ternaries to if/else  │
 │                                                                         │
 │  Stage 3: String Decryption & Constant Evaluation                       │
 │  ├── 10. decode-string-banks    Sandbox-harvest & inline string banks   │
 │  ├── 11. simplify-tricks        Fold coercion tricks (![], !0, void 0)  │
 │  ├── 12. normalize-conditions   Flip inverted Yoda comparisons          │
 │  ├── 13. fold-number-tostring   Fold Number(n).toString(radix)          │
 │  ├── 14. fold-unescape          Fold unescape, atob, btoa, URI codecs   │
 │  ├── 15. fold-constants         Pure binary/unary/logical fixpoint loop │
 │  └── 16. propagate-constants    Propagate constant values & aliases     │
 │                                                                         │
 │  Stage 4: Secondary Fixpoint Pass                                       │
 │  ├── 17. strip-debug-traps      Purge traps exposed by folded strings   │
 │  ├── 18. strip-self-defending   Re-evaluate exposed tamper controllers  │
 │  ├── 19. inline-proxies         Inline remaining secondary proxies      │
 │  ├── 20. unflatten-control-flow Unflatten remaining nested dispatchers  │
 │  ├── 21. unwrap-logical-guards  Unwrap newly exposed logical guards     │
 │  ├── 22. unwrap-ternaries       Unwrap newly exposed statement ternaries│
 │  ├── 23. fold-constants         Fold newly exposed constant expressions │
 │  └── 24. propagate-constants    Collapse secondary alias references     │
 │                                                                         │
 │  Stage 5: Normalization & Final Polish                                  │
 │  ├── 25. normalize-conditions   Final sweep on inverted comparisons     │
 │  ├── 26. normalize-literals     Convert 0x1f4 -> 500 and unescape chars │
 │  ├── 27. normalize-member       Rewrite a["prop"] -> a.prop             │
 │  ├── 28. remove-dead-code       Drop literal branches & unreachable code│
 │  ├── 29. rename-identifiers     Scope-aware renaming of junk tokens     │
 │  └── 30. cleanup                Prune empty statements & pure literals  │
 │                                                                         │
 └────────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
                        Clean Source + Audit Report
```

---

## Installation & Quick Start

### Command Line

```bash
# Clone the repository
git clone https://github.com/cipherwire/disarm.git
cd disarm

# Install dependencies
npm install

# Run verification suite
npm test

# Deobfuscate a target script
node src/cli.js challenge.js -o output/challenge.clean.js
```

### Programmatic API

```javascript
import { deobfuscate } from './src/index.js';

const hostileCode = `
var _0xseq = "2|0|1".split("|"), _0xidx = 0;
while (true) {
  switch (_0xseq[_0xidx++]) {
    case "0": var b = 2; continue;
    case "1": return a + b;
    case "2": var a = 1; continue;
  }
  break;
}
`;

const { code, report } = deobfuscate(hostileCode);

console.log(code);
// Output:
// var a = 1;
// var b = 2;
// return a + b;

console.log(report.totalChanges());
// Output: 4
```

---

## Deobfuscation Engine

### 1. Control-Flow Unflattening
Transforms scrambled state-machine loops back into clean sequential execution blocks:

```javascript
// Before
var seq = "2|0|1".split("|"), idx = 0;
while (true) {
  switch (seq[idx++]) {
    case "0": b(); continue;
    case "1": c(); continue;
    case "2": a(); continue;
  }
  break;
}

// After disarm
a();
b();
c();
```

### 2. Proxy Function & Dictionary Inlining
Inlines single-return wrapper functions and object dictionary operation dispatchers, pruning unused declarations:

```javascript
// Before
var dict = {
  "add": function(a, b) { return a + b; },
  "key": "token"
};
var total = dict.add(10, 20);
var header = dict.key;

// After disarm
var total = 30;
var header = "token";
```

### 3. Isolated String-Bank Harvester
Runs the target script inside a hardened Node `vm` context with simulated browser APIs (`window`, `document`, `navigator`, `location`, `screen`, `localStorage`, `crypto`). Probes all discovered decoder functions with literal arguments, inlines the returned values, and skips runtime decryption overhead.

### 4. Fixpoint Constant Folding
Performs iterative evaluation across unary, binary, and logical expressions until reaching a fixpoint:
- Fold negative arithmetic: `10 - 20` -> `-10`, `-5 * 3` -> `-15`
- Fold bitwise inversions: `~0` -> `-1`
- Fold string concatenations: `"val: " + (5 - 10)` -> `"val: -5"`
- Fold radix strings: `(255).toString(16)` -> `"ff"`
- Fold base64 and URI decoders: `atob("aGVsbG8=")` -> `"hello"`

### 5. Anti-Tamper & Trap Neutralization
Hostile challenge scripts detect beautification and formatting by checking function length or calling `Function("debugger")`. **disarm** neutralizes single-call controllers with harmless no-op factories, drops inline interval timers (`setInterval(trap, 1000)`), and strips debugger statements before evaluation.

### 6. Comma Sequence Splitting
Unwraps dense comma-separated sequence chains inside expression statements, return statements, and variable declarators into readable sequential lines:

```javascript
// Before
(a = 1, b = 2, calculate(a + b));
return x = 10, y = 20, x + y;

// After disarm
a = 1;
b = 2;
calculate(a + b);
x = 10;
y = 20;
return x + y;
```

### 7. Logical Guard Unwrapping
Transforms short-circuit logical guards (`&&` and `||`) used to obscure conditional branches into structured `if` statements:

```javascript
// Before
ready && initialize();
!verified || unlock();

// After disarm
if (ready) {
  initialize();
}
if (verified) {
  unlock();
}
```

### 8. Multi-Hop Constant & Alias Propagation
Propagates pure constant literals and collapses single-assignment variable alias chains directly to their usage sites:

```javascript
// Before
var base = "https://endpoint.local";
var alias1 = base;
var alias2 = alias1;
sendTelemetry(alias2);

// After disarm
sendTelemetry("https://endpoint.local");
```

### 9. Literal & Character Normalization
Normalizes obscure hexadecimal numbers and escaped unicode/hex strings back to clean decimals and unescaped UTF-8 characters:

```javascript
// Before
var port = 0x1bb;
var zero = 0x0;
var text = "\x68\x65\x6c\x6c\x6f";

// After disarm
var port = 443;
var zero = 0;
var text = "hello";
```

### 10. Statement Ternary Unrolling
Converts statement-level ternary expressions into structured `if/else` and `else if` blocks:

```javascript
// Before
isReady ? (initialize(), start()) : (retryCount++, wait());

// After disarm
if (isReady) {
  initialize();
  start();
} else {
  retryCount++;
  wait();
}
```

### 11. Yoda Condition Normalization
Inverts backwards comparisons to place expressions and variables on the left and literals on the right:

```javascript
// Before
if ("hidden" === document.visibilityState && 402 === res.status && 0 < val)

// After disarm
if (document.visibilityState === "hidden" && res.status === 402 && val > 0)
```

### 12. Compound Declaration Splitting
Breaks compound multi-variable declarations into clean standalone statements:

```javascript
// Before
var a = init(), b = configure(), c = start();

// After disarm
var a = init();
var b = configure();
var c = start();
```

---

## CLI Reference

```
Usage:
  disarm <input.js> [-o output.js] [--report report.json] [--no-sandbox]

Options:
  -o, --output    Write cleaned JavaScript here (default: output/<basename>.clean.js)
  --report        Write the JSON audit report here (default: output/<basename>.report.json)
  --no-sandbox    Disable the sandboxed string-bank harvester
  -h, --help      Show usage details
```

### Automatic Large Bundle Scaling
When analyzing large enterprise production bundles (>= 2.5 MB), `disarm` inspects the input file size and current V8 heap limit. If the environment is constrained (such as standard CI or Docker containers defaulting to ~2 GB), `disarm` automatically scales its V8 old space heap limit to 4096 MB under the hood without requiring manual Node CLI flags.

### Audit Report Output
Each run outputs a structured audit log detailing changes made across every pass:

```json
{
  "tool": "disarm",
  "generatedAt": "2026-10-27T12:00:00.000Z",
  "totalChanges": 118,
  "passes": [
    { "name": "detect-techniques", "changes": 0, "notes": ["techniques: switch-dispatch-loop×1"] },
    { "name": "split-sequences", "changes": 12, "notes": ["unwrapped 12 comma sequence expression(s)"] },
    { "name": "split-declarations", "changes": 5, "notes": ["split 5 compound variable declaration(s)"] },
    { "name": "inline-proxies", "changes": 27, "notes": ["inlined 27 proxy function/object call(s)"] },
    { "name": "unflatten-control-flow", "changes": 1, "notes": ["unflattened 1 control-flow dispatch loop(s)"] },
    { "name": "unwrap-logical-guards", "changes": 8, "notes": ["unwrapped 8 logical guard expression(s) into if-statements"] },
    { "name": "unwrap-ternaries", "changes": 4, "notes": ["unwrapped 4 statement ternary expression(s)"] },
    { "name": "normalize-conditions", "changes": 6, "notes": ["normalized 6 Yoda condition(s)"] },
    { "name": "decode-string-banks", "changes": 17, "notes": ["found 1 decoder function(s)"] },
    { "name": "fold-constants", "changes": 51, "notes": [] },
    { "name": "propagate-constants", "changes": 14, "notes": ["propagated 14 constant literal(s) and alias(es)"] },
    { "name": "normalize-literals", "changes": 9, "notes": ["normalized 9 hexadecimal or escaped literal(s)"] },
    { "name": "normalize-member", "changes": 7, "notes": [] }
  ],
  "warnings": [],
  "meta": {
    "techniques": [{ "name": "switch-dispatch-loop", "count": 1 }]
  }
}
```

---

## Verification & CI

Automated GitHub Actions workflows run across Linux, macOS, and Windows on Node.js 18, 20, and 22:

```bash
# Execute the complete verification test suite
npm test
```

Verification suite checks:
1. Control-flow unflattening state recovery
2. Proxy function wrapper inlining
3. Object dictionary operation inlining
4. Negative arithmetic and unary constant folding
5. Coercion trick simplification (`!0`, `!1`, `[][[]] + ""`)
6. Member normalization on ECMAScript reserved words (`obj.default`, `obj.catch`)
7. Trap stripping and anti-tamper neutralization
8. Comma sequence expression splitting in statements and returns
9. Logical guard unwrapping into structured if-statements
10. Constant literal and multi-hop alias chain propagation
11. Literal normalization (hexadecimal to decimal, escaped chars to strings)
12. End-to-end modern challenge reconstruction combining all passes
13. Statement ternary unrolling into structured if-else blocks
14. Yoda condition normalization for equality and inequality operators
15. Compound variable declaration splitting

---

## License

[MIT](LICENSE)
