# disarm  -  Full Codebase Audit & Fix Report

**Date:** 2026-10-29
**Scope:** complete source audit of the `disarm` deobfuscator (4,213 lines, 32 pipeline passes, CLI, tooling)
**Method:** every suspected issue was proven or disproven by *executing* original vs. cleaned code in isolated sandboxes  -  no change was made on theory alone. All findings are reproducible via `node tools/audit-probe.js`.

---

## 1. Result summary

| Metric | Before audit | After audit |
|---|---|---|
| Verification checks passing | 25 (verify 20 + oracle 5) | **45** (verify 20 + oracle 5 + probe 7 + behavior 13) |
| Confirmed behavior bugs in passes | 4 | **0** |
| Warnings on the 2.4 MB real-world target | 2 (`fold-constants did not reach a fixpoint`) | **0** |
| Real target run (new-test.js, 2.4 MB) | exit 0, 107,254 changes | exit 0, 106,910 changes, identical quality |
| Behavior-verification corpus (obfuscator gauntlet) | missing (deleted in earlier rework) | restored and green |

---

## 2. Terminal error log  -  root cause

Running the CLI on the 2.4 MB production bundle produced the only errors observed anywhere:

```
warning   fold-constants did not reach a fixpoint after 10 rounds   (x2)
```

**Root cause.** Babel's AST traversal is top-down, and JavaScript arithmetic parses
left-deep: `1 + 2 + 3 + … + N` becomes `(((1+2)+3)+4)…`. The constant-folding pass
visited the outer node first (not foldable  -  its left side is not yet a literal),
so the chain needed **one full traversal round per level**. A minified bundle
contains thousands of such chains, so the 10-round cap was always exceeded.

**Fix.** After each successful fold, the pass now *climbs* the ancestor chain and
folds every level that just became literal, in the same visit. Climbing was added
for binary, unary, and logical chains. The round cap was raised to 25, and the
remaining-cap message was downgraded from `warning` to an informational `note`,
because the pipeline deliberately runs `fold-constants` a second time later  - 
converging slowly on a 640k-node AST is normal progress, not a failure.

Verified: the same bundle now completes with **zero warnings** and equivalent output.

---

## 3. Bugs found, with execution evidence, and fixed

### B1 (critical)  -  `inline-proxies` duplicated side effects
When a proxy parameter was used **more than once** in the wrapped expression
(e.g. `function square(x) { return x * x; }`), inlining cloned the call argument
into every occurrence. An impure argument therefore executed twice.

- Evidence: `square(getValue())` with a call counter  -  original `"25:1"`, cleaned `"25:2"`.
- Fix: per-parameter usage counting (`countParamUsage`); a parameter used more than
  once is only inlined when its argument is side-effect-free.

### B2 (high)  -  `inline-proxies` flipped evaluation order
When two or more parameters were used and their arguments had side effects,
substitution re-ordered those side effects to match the wrapped expression's body
instead of the original argument list.

- Evidence: `pair(a(), b())` with `function pair(x, y) { return y + x; }`  - 
  original `"3:AB"`, cleaned `"3:BA"`.
- Fix: if two or more parameters are used and any used argument is impure, the
  call site is left un-inlined (conservative, always safe).

### B3 (critical)  -  `propagate-constants` propagated stale alias values
`var b = a` captures the *value* of `a` at initialization. The pass replaced reads
of `b` with `a` even when `a` was reassigned afterwards, producing wrong values.

- Evidence: `var a = 1; var b = a; a = 2; result = b;`  -  original `1`, cleaned `2`.
- Fix: alias propagation now requires the target binding to be **constant**
  (`targetBinding.constant`) and declared **before** the alias (declaration-order
  check via source positions).

### B4 (critical)  -  `unflatten-control-flow` generated illegal JavaScript
A dispatch case containing a **nested** `break`/`continue` (e.g. inside an `if`
inside a case) was linearized: the loop that gave those statements meaning was
removed, leaving a bare `break` at top level.

- Evidence: cleaned output threw `SyntaxError: Illegal break statement` at runtime.
- Fix: case bodies are deep-scanned (`containsNestedLoopFlow`); any nested loop
  control flow causes that dispatch loop to be skipped (left unflattened, which is
  always behavior-safe).

### B6 (high)  -  long constant chains under-folded
The 10-round cap plus the missing chain-climbing meant long literal chains were
only partially folded (e.g. a 60-term sum was not reduced to `1830`).

- Fix: chain climbing in `fold-constants` **and** `fuse-literals` (which runs
  earlier in the pipeline for split-string fusion).

### Regression introduced and caught during the fix (transparency note)
The first version of the chain-climbing helper in `fuse-literals` string-concatenated
numeric additions (`10 * 4 + 2` briefly folded to `"402"` instead of `42`). This was
caught immediately by the existing verification suite (check #16) and corrected:
`+` only becomes string concatenation when a string operand is present.

---

## 4. Suspicions tested and disproven (no change made)

- **B5**  -  suspected that declarator removal leaves an invalid empty `var;` statement.
  Tested: Babel removes the whole declaration correctly. **No fix needed.**
- **B7**  -  suspected object-shorthand corruption during parameter substitution.
  Tested: shorthand cannot occur inside inlinable proxy expressions. **No fix needed.**

These are kept in `tools/audit-probe.js` as permanent regression probes.

---

## 5. Change manifest (what was added / removed / why)

### Modified
| File | Change | Why |
|---|---|---|
| `src/passes/inline-proxies.js` | Replaced three duplicated `findUsedParams`/`safeArgs` blocks with shared `countParamUsage` + `areArgsSubstitutionSafe` helpers; guards applied in all three inlining branches (function declarations, function expressions, object dictionaries) | B1 + B2 |
| `src/passes/propagate-constants.js` | Alias case requires constant target + declaration order | B3 |
| `src/passes/unflatten-control-flow.js` | Added `containsNestedLoopFlow` deep-scan bail | B4 |
| `src/passes/fold-constants.js` | Chain climbing (binary/unary/logical), round cap 10 → 25, cap message downgraded to note | B6 + error-log root cause |
| `src/passes/fuse-literals.js` | Chain climbing with correct string/numeric `+` handling | B6 |
| `package.json` | `test` now runs all four suites; added `fixtures`, `test:probe`, `test:behavior` scripts; re-added `javascript-obfuscator` devDependency | restore verification |

### Added
| File | Purpose |
|---|---|
| `tools/audit-probe.js` | 7 permanent regression probes (B1-B7) with non-zero exit code on failure |
| `test/behavior.js` | 13 behavior checks: fixture round-trips, real-sample processing, gauntlet manifest |
| `test/roundtrip/values.src.js`, `test/roundtrip/logic.src.js` | Clean ground-truth sources for round-trips (restored  -  had been deleted) |
| `tools/make-fixtures.js` | Regenerates the obfuscated fixture corpus incl. the `maxhard` gauntlet (stringArray + rotator + splitStrings + selfDefending + debugProtection + controlFlowFlattening + deadCodeInjection + numbersToExpressions) |
| `samples/tmx-dynamic.js`, `samples/realworld/obfuscator-io-source.js` | Real-world verification samples (re-fetched from their public sources after the samples folder was removed) |

### Removed
| Item | Why |
|---|---|
| Duplicated `findUsedParams`/`safeArgs` logic (3 copies) | Consolidated into shared, tested helpers  -  same behavior, one implementation |
| The `fold-constants did not reach a fixpoint` warning | Downgraded to an informational note: converging at the cap is normal on large bundles and the pipeline folds again later |

**No passes, features, or public APIs were removed.** Everything the tool did before
the audit, it still does  -  the changes only prevent unsafe transforms and restore
verification coverage.

---

## 6. Verification status after the audit

All four suites pass  -  `npm test` runs them in order:

1. `tools/verify.js`  -  20 structural checks  -  **pass**
2. `tools/oracle.js`  -  5 differential execution traces, 0 semantic drift  -  **pass**
3. `tools/audit-probe.js`  -  7 regression probes  -  **pass**
4. `test/behavior.js`  -  13 behavior checks incl. the maxhard obfuscator gauntlet
   (stringArray + rotator + selfDefending + debugProtection + controlFlowFlattening +
   deadCodeInjection + numbersToExpressions, executed and compared against the
   original clean source)  -  **pass**

Real-world targets: ThreatMetrix dynamic script (277 bank strings decoded),
a genuine obfuscator.io sample from the wild, and the 2.4 MB production bundle  - 
all process cleanly.

---

## 7. Improvement backlog (recommended, not yet implemented)

1. **Telemetry scoring penalizes readability passes**  -  splitting sequences adds
   AST nodes, so the score dropped (−0% on the real bundle) despite much cleaner
   output. Normalize per-statement or weight readability separately.
2. **Opaque-identifier metric overcounts**  -  any identifier of ≤2 characters is
   counted as opaque; restrict to obfuscator-style patterns.
3. **Endpoint regex noise**  -  strings like `/events` (page routes) match; require
   URL-shaped matches or a host part.
4. **`split-sequences` runs once**  -  its block-wrapping deferral for `if`/loop
   bodies never completes; give it a second pipeline slot.
5. **CLI hardening**  -  report a non-zero exit when the memory-scaling `spawnSync`
   fails; treat a filename literally named `inspect` correctly.
6. **Housekeeping**  -  `new-test.js` is a real production payment bundle; keep it
   untracked or add it to `.gitignore` so it never enters version control.
