import { detectTechniques } from './detect-techniques.js';
import { splitSequences } from './split-sequences.js';
import { splitDeclarations } from './split-declarations.js';
import { stripDebugTraps } from './strip-debug-traps.js';
import { stripSelfDefending } from './strip-self-defending.js';
import { inlineProxies } from './inline-proxies.js';
import { unflattenControlFlow } from './unflatten-control-flow.js';
import { unwrapLogicalGuards } from './unwrap-logical-guards.js';
import { unwrapTernaries } from './unwrap-ternaries.js';
import { decodeStringBanks } from './decode-string-banks.js';
import { simplifyTricks } from './simplify-tricks.js';
import { normalizeConditions } from './normalize-conditions.js';
import { foldNumberToString } from './fold-number-tostring.js';
import { foldUnescape } from './fold-unescape.js';
import { foldConstants } from './fold-constants.js';
import { propagateConstants } from './propagate-constants.js';
import { normalizeLiterals } from './normalize-literals.js';
import { normalizeMember } from './normalize-member.js';
import { removeDeadCode } from './remove-dead-code.js';
import { renameIdentifiers } from './rename-identifiers.js';
import { cleanup } from './cleanup.js';

/** Ordered pipeline: fingerprint, strip hostile helpers, inline proxies, unflatten control flow, decode strings, then clean up.
 * The strip passes run a second time after constant folding: string-bank
 * decoders obfuscate their own trap arguments ('debu' + 'gger' from bank
 * pieces), and only after folding do those arguments become matchable
 * literals. */
export const defaultPasses = [
  detectTechniques,
  splitSequences,
  splitDeclarations,
  stripDebugTraps,
  stripSelfDefending,
  inlineProxies,
  unflattenControlFlow,
  unwrapLogicalGuards,
  unwrapTernaries,
  decodeStringBanks,
  simplifyTricks,
  normalizeConditions,
  foldNumberToString,
  foldUnescape,
  foldConstants,
  propagateConstants,
  stripDebugTraps,
  stripSelfDefending,
  inlineProxies,
  unflattenControlFlow,
  unwrapLogicalGuards,
  unwrapTernaries,
  foldConstants,
  propagateConstants,
  normalizeConditions,
  normalizeLiterals,
  normalizeMember,
  removeDeadCode,
  renameIdentifiers,
  cleanup,
];

export {
  detectTechniques,
  splitSequences,
  splitDeclarations,
  stripDebugTraps,
  stripSelfDefending,
  inlineProxies,
  unflattenControlFlow,
  unwrapLogicalGuards,
  unwrapTernaries,
  decodeStringBanks,
  simplifyTricks,
  normalizeConditions,
  foldNumberToString,
  foldUnescape,
  foldConstants,
  propagateConstants,
  normalizeLiterals,
  normalizeMember,
  removeDeadCode,
  renameIdentifiers,
  cleanup,
};
