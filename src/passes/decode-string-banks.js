import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
import { print, parse } from '../core/index.js';
import { runAndCollect } from '../sandbox/harvest.js';
import { memberPathParts, isAllStringArray, evalLiteralExpr } from '../utils/ast.js';

const traverse = traverseModule.default ?? traverseModule;

const DUMP_VAR = '__unmask_dump';

/** Build `try { DUMP_VAR["root"] = (typeof root !== "undefined") ? root : null } catch (e) {}`. */
function dumpStatements(roots) {
  return roots.map((root) => {
    const probe = t.conditionalExpression(
      t.binaryExpression(
        '!==',
        t.unaryExpression('typeof', t.identifier(root)),
        t.stringLiteral('undefined'),
      ),
      t.identifier(root),
      t.nullLiteral(),
    );
    const assignment = t.assignmentExpression(
      '=',
      t.memberExpression(t.identifier(DUMP_VAR), t.stringLiteral(root), true),
      probe,
    );
    return t.tryStatement(
      t.blockStatement([t.expressionStatement(assignment)]),
      t.catchClause(t.identifier('e'), t.blockStatement([])),
    );
  });
}

/** Body of the outermost IIFE when the file is one (challenge scripts usually are), else the program body. */
function insertionBody(ast) {
  const body = ast.program.body;
  const last = body[body.length - 1];
  if (last && t.isExpressionStatement(last)) {
    let expr = last.expression;
    if (t.isUnaryExpression(expr)) expr = expr.argument;
    if (t.isCallExpression(expr)) {
      let fn = expr.callee;
      // (function(){})() :  parens are dropped in the AST
      if (t.isCallExpression(fn) && t.isFunctionExpression(fn.callee)) fn = fn.callee;
      if (t.isFunctionExpression(fn) && t.isBlockStatement(fn.body)) return fn.body.body;
    }
  }
  return body;
}

/** Wrap a statement in `try { ... } catch (e) {}` so one hostile statement can't unwind the rest. */
function isolate(node) {
  return t.tryStatement(
    t.blockStatement([node]),
    t.catchClause(t.identifier('e'), t.blockStatement([])),
  );
}

function referencesIdentifier(node, name) {
  let found = false;
  (function walk(current) {
    if (!current || typeof current !== 'object' || found) return;
    if (Array.isArray(current)) {
      for (const item of current) walk(item);
      return;
    }
    if (current.type === 'Identifier' && current.name === name) {
      found = true;
      return;
    }
    for (const key of Object.keys(current)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      walk(current[key]);
    }
  })(node);
  return found;
}

/** True when the body calls any of the given names: `var a = getter();` */
function callsAnyOf(body, names) {
  let found = false;
  (function walk(node) {
    if (!node || typeof node !== 'object' || found) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node.type === 'CallExpression' && t.isIdentifier(node.callee) && names.has(node.callee.name)) {
      found = true;
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      walk(node[key]);
    }
  })(body);
  return found;
}

/** True when the body indexes any identifier with computed member access: `arr[expr]`. */
function hasComputedIndex(body) {
  let found = false;
  (function walk(node) {
    if (!node || typeof node !== 'object' || found) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node.type === 'MemberExpression' && node.computed && t.isIdentifier(node.object)) {
      found = true;
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      walk(node[key]);
    }
  })(body);
  return found;
}

/** True when the body computes a member access on any of the given names. */
function indexesAnyOf(body, names) {
  let found = false;
  (function walk(node) {
    if (!node || typeof node !== 'object' || found) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node.type === 'MemberExpression' && node.computed &&
        t.isIdentifier(node.object) && names.has(node.object.name)) {
      found = true;
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      walk(node[key]);
    }
  })(body);
  return found;
}

/** Name of the variable/function a function expression is bound to, if any. */
function functionOwnerName(path, node) {
  if (t.isFunctionDeclaration(node) && node.id) return node.id.name;
  if (path.parentPath?.isVariableDeclarator() && t.isIdentifier(path.parentPath.node.id)) {
    return path.parentPath.node.id.name;
  }
  return null;
}

function containsAllStringArray(body) {
  let found = false;
  (function walk(node) {
    if (!node || typeof node !== 'object' || found) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (isAllStringArray(node)) {
      found = true;
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      walk(node[key]);
    }
  })(body);
  return found;
}

/**
 * The flagship pass, generalized from the ThreatMetrix case to any
 * string-concealing scheme with two shapes:
 *
 *   1. instance banks :  `var bank = new Obj.Decoder("key…")`, strings read
 *      via `bank.read(offset, length)` (ThreatMetrix and friends);
 *   2. function-call banks :  an all-string array plus decoder functions
 *      that index it (`array[idx]`), as javascript-obfuscator emits.
 *
 * Strategy: expand conditional literal arguments first
 * (`f(test ? 1 : 2)` → `test ? f(1) : f(2)`), run the script in a hardened
 * sandbox, harvest the live decoder objects/functions, then probe every
 * observed call site with its literal arguments and inline whatever
 * returns a string. Because we execute the vendor's own decoders, scheme
 * internals (XOR, base64, RC4, rotation, index shifts) don't matter.
 */
export const decodeStringBanks = {
  name: 'decode-string-banks',
  description: 'Harvest string banks and decoder functions in a sandbox, then inline decodable call sites.',
  run(ast, report, context) {
    if (context?.options?.sandbox === false) {
      report.note('sandbox disabled, skipping');
      return;
    }

    // 0. Expand conditional literal arguments so both branches become decodable.
    let expanded = 0;
    const expandable = [];
    traverse(ast, {
      CallExpression(path) {
        if (path.node.arguments.some(
          (arg) => t.isConditionalExpression(arg) &&
            evalLiteralExpr(arg.consequent) !== undefined &&
            evalLiteralExpr(arg.alternate) !== undefined,
        )) {
          expandable.push(path);
        }
      },
    });
    for (const path of expandable) {
      try {
        const call = path.node;
        const index = call.arguments.findIndex(
          (arg) => t.isConditionalExpression(arg) &&
            evalLiteralExpr(arg.consequent) !== undefined &&
            evalLiteralExpr(arg.alternate) !== undefined,
        );
        if (index === -1) continue;
        const arg = call.arguments[index];
        const buildBranch = (value) => t.callExpression(
          t.cloneNode(call.callee, true),
          call.arguments.map((a, i) => (i === index ? t.valueToNode(value) : t.cloneNode(a, true))),
        );
        path.replaceWith(t.conditionalExpression(
          t.cloneNode(arg.test, true),
          buildBranch(evalLiteralExpr(arg.consequent)),
          buildBranch(evalLiteralExpr(arg.alternate)),
        ));
        expanded++;
      } catch {
        // stale path from an earlier replacement in this snapshot :  skip
      }
    }
    if (expanded > 0) report.note(`expanded ${expanded} conditional decoder argument(s)`);

    // 1. Detect banks: instance-style and function-call-style.
    const roots = new Set();
    const instances = []; // { dumpRoot, subPath }
    const functionDecoders = new Set();

    traverse(ast, {
      AssignmentExpression(path) {
        const right = path.node.right;
        if (!t.isNewExpression(right)) return;
        const calleeParts = memberPathParts(right.callee);
        if (!calleeParts || calleeParts.length < 2) return;
        if (right.arguments.length !== 1 || !t.isStringLiteral(right.arguments[0])) return;
        const leftParts = memberPathParts(path.node.left);
        if (!leftParts) return;
        roots.add(leftParts[0]);
        instances.push({ dumpRoot: leftParts[0], subPath: leftParts.slice(1) });
      },
      VariableDeclarator(path) {
        const init = path.node.init;
        if (!init || !t.isNewExpression(init)) return;
        const calleeParts = memberPathParts(init.callee);
        if (!calleeParts || calleeParts.length < 2) return;
        if (init.arguments.length !== 1 || !t.isStringLiteral(init.arguments[0])) return;
        if (!t.isIdentifier(path.node.id)) return;
        roots.add(path.node.id.name);
        instances.push({ dumpRoot: path.node.id.name, subPath: [] });
      },
    });

    // Function-call route. Two array-storage shapes exist:
    //   plain:     var arr = ["a", "b", ...]  :  decoders index `arr` directly
    //   wrapped:   function get() { var a = ["a", ...]; get = ...; return a; }
    //              :  decoders call the getter and index a local alias
    const arrayVars = new Set();
    const arrayGetters = new Set();
    traverse(ast, {
      VariableDeclarator(path) {
        if (t.isIdentifier(path.node.id) && path.node.init && isAllStringArray(path.node.init)) {
          arrayVars.add(path.node.id.name);
        }
      },
      'FunctionDeclaration|FunctionExpression'(path) {
        if (!containsAllStringArray(path.node.body)) return;
        const name = functionOwnerName(path, path.node);
        if (name) arrayGetters.add(name);
      },
    });
    if (arrayVars.size > 0 || arrayGetters.size > 0) {
      traverse(ast, {
        'FunctionDeclaration|FunctionExpression'(path) {
          const name = functionOwnerName(path, path.node);
          if (!name || functionDecoders.has(name) || arrayGetters.has(name)) return;
          // A decoder indexes an identifier AND either indexes a known array
          // variable or calls a known array getter somewhere in its body.
          if (!hasComputedIndex(path.node.body)) return;
          const usesPlainArray = indexesAnyOf(path.node.body, arrayVars);
          const usesGetter = arrayGetters.size > 0 && callsAnyOf(path.node.body, arrayGetters);
          if (usesPlainArray || usesGetter) {
            functionDecoders.add(name);
            roots.add(name);
          }
        },
      });
    }

    if (roots.size === 0) {
      report.note('no string banks or decoder functions found');
      return;
    }
    report.note(`found ${instances.length} bank instance(s), ${functionDecoders.size} decoder function(s)`);

    // 2. Sandbox experiments run on a throwaway copy of the AST: dump probes
    //    and statement isolation must never leak into the cleaned output.
    const rootList = [...roots];
    const workingAst = parse(print(ast));
    const insertion = insertionBody(workingAst);
    const probes = dumpStatements(rootList);
    insertion.push(...probes);

    // 3. Harvest. If the script threw mid-run, retry with every statement
    //    isolated so a hostile top-level statement cannot unwind the rest.
    //    (Isolation can still not rescue an infinite loop :  the vm timeout
    //    kills the whole run :  which is why hostile loop-generators must be
    //    stripped BEFORE this pass.)
    let dump = runAndCollect(print(workingAst), rootList).dump;
    if (Object.values(dump).every((value) => value == null)) {
      report.note('first harvest empty :  retrying with isolated statements');
      const isolated = insertion.slice(0, insertion.length - probes.length).map(isolate);
      insertion.splice(0, insertion.length, ...isolated, ...probes);
      dump = runAndCollect(print(workingAst), rootList).dump;
    }

    // 4. Registry: methods exposed by harvested instances, plus the decoder
    //    functions themselves.
    const lookup = (parts) => {
      let obj = dump[parts[0]];
      for (let i = 1; obj != null && i < parts.length; i++) obj = obj[parts[i]];
      return obj;
    };

    const decoderMethods = new Set();
    for (const instance of instances) {
      const obj = lookup([instance.dumpRoot, ...instance.subPath]);
      if (!obj || typeof obj !== 'object') continue;
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'function') decoderMethods.add(key);
      }
    }

    // 5. Inline every call site the sandbox can decode.
    let inlined = 0;
    const replaceSite = (path, decoded, guardName) => {
      const parent = path.parentPath;
      if (
        parent?.isConditionalExpression() &&
        parent.node.consequent === path.node &&
        referencesIdentifier(parent.node.test, guardName)
      ) {
        parent.replaceWith(t.stringLiteral(decoded));
      } else {
        path.replaceWith(t.stringLiteral(decoded));
      }
      inlined++;
    };

    // Obfuscators call decoders through local aliases
    // (`var a = decoder;` inside every function) :  follow the chain.
    const resolveDecoderAlias = (path, name) => {
      let current = name;
      const seen = new Set();
      for (let hop = 0; hop < 6; hop++) {
        if (functionDecoders.has(current)) return current;
        if (seen.has(current)) return null;
        seen.add(current);
        const binding = path.scope.getBinding(current);
        if (!binding || !binding.path?.isVariableDeclarator()) return null;
        const init = binding.path.node.init;
        if (!init || !t.isIdentifier(init)) return null;
        current = init.name;
      }
      return null;
    };

    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;
        const args = path.node.arguments;
        if (args.length === 0) return;
        const values = [];
        for (const arg of args) {
          const value = evalLiteralExpr(arg);
          if (typeof value !== 'number' && typeof value !== 'string') return;
          values.push(value);
        }

        if (t.isMemberExpression(callee) && !callee.computed &&
            t.isIdentifier(callee.property) && decoderMethods.has(callee.property.name)) {
          const objectParts = memberPathParts(callee.object);
          if (!objectParts || !roots.has(objectParts[0])) return;
          const instance = lookup(objectParts);
          if (instance == null || typeof instance[callee.property.name] !== 'function') return;
          let decoded;
          try {
            decoded = instance[callee.property.name](...values);
          } catch {
            return;
          }
          if (typeof decoded === 'string') {
            replaceSite(path, decoded, objectParts[0]);
          }
        } else if (t.isIdentifier(callee)) {
          const decoderName = resolveDecoderAlias(path, callee.name);
          if (!decoderName) return;
          const fn = dump[decoderName];
          if (typeof fn !== 'function') return;
          let decoded;
          try {
            decoded = fn(...values);
          } catch {
            return;
          }
          if (typeof decoded === 'string') {
            replaceSite(path, decoded, decoderName);
          }
        }
      },
    });

    report.count(inlined + expanded);
    report.meta.banksRootedAt = rootList;
    if (inlined === 0 && expanded === 0) {
      report.warn('bank objects were harvested but no call sites could be decoded');
    }
  },
};
