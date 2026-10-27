import traverseModule from '@babel/traverse';
import * as t from '@babel/types';

const traverse = traverseModule.default ?? traverseModule;

/**
 * Detect the "single call controller" shape anti-tamper code is wrapped in:
 * an IIFE holding a one-shot flag, returning a function that invokes another
 * function once via `.apply`, nulls it out, and flips the flag. The wrapped
 * payload never affects program output :  it only verifies that the code
 * wasn't reformatted, punishing violations with an infinite loop.
 *
 * Strategy: NEUTRALIZE, don't excise. Challenge scripts route controllers
 * and their wrappers through decoy-object indirections, conditional shells,
 * and helper calls :  removing the declarations surgically leaves dangling
 * references behind (learned the hard way on the gauntlet fixture). Instead:
 *   - the controller IIFE becomes a factory returning a no-op function,
 *   - every call `ctrl(this, payload)` becomes a no-op function literal,
 *     which also drops the payload from the tree,
 *   - any other reference becomes a no-op function literal.
 * Downstream code keeps running; the payload can never execute.
 */
function isCallControllerBody(body) {
  let hasApply = false;
  let hasNullAssign = false;
  let hasTrueFlag = false;
  let hasFalseAssign = false;
  const isTrueShape = (node) =>
    (t.isBooleanLiteral(node) && node.value === true) ||
    (t.isNumericLiteral(node) && node.value === 1) ||
    (t.isUnaryExpression(node) && node.operator === '!' &&
      ((t.isNumericLiteral(node.argument) && node.argument.value === 0) ||
        (t.isUnaryExpression(node.argument) && node.argument.operator === '!' &&
          t.isArrayExpression(node.argument.argument) && node.argument.argument.elements.length === 0)));
  const isFalseShape = (node) =>
    (t.isBooleanLiteral(node) && node.value === false) ||
    (t.isNumericLiteral(node) && node.value === 0) ||
    (t.isUnaryExpression(node) && node.operator === '!' &&
      ((t.isNumericLiteral(node.argument) && node.argument.value === 1) ||
        (t.isArrayExpression(node.argument) && node.argument.elements.length === 0)));
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node.type === 'CallExpression' && t.isMemberExpression(node.callee)) {
      const property = node.callee.property;
      const isApply =
        (!node.callee.computed && t.isIdentifier(property) && property.name === 'apply') ||
        (node.callee.computed && (t.isStringLiteral(property) && property.value === 'apply' ||
          t.isCallExpression(property)));
      if (isApply) hasApply = true;
    }
    if (node.type === 'AssignmentExpression' && node.operator === '=' && t.isNullLiteral(node.right)) {
      hasNullAssign = true;
    }
    if (node.type === 'AssignmentExpression' && node.operator === '=' && isFalseShape(node.right)) {
      hasFalseAssign = true;
    }
    if (node.type === 'VariableDeclarator' && node.init && isTrueShape(node.init)) {
      hasTrueFlag = true;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      walk(node[key]);
    }
  })(body);
  return hasApply && hasNullAssign && hasTrueFlag && hasFalseAssign;
}

const noopFactory = () =>
  t.functionExpression(null, [], t.blockStatement([
    t.returnStatement(t.functionExpression(null, [], t.blockStatement([]))),
  ]));
const noopFn = () => t.functionExpression(null, [], t.blockStatement([]));

export const stripSelfDefending = {
  name: 'strip-self-defending',
  description: 'Neutralize single-call controllers and their anti-tamper payloads with no-op functions.',
  run(ast, report, context) {
    const annotate = Boolean(context?.options?.annotate);
    const controllers = []; // { initPath, name, binding }
    traverse(ast, {
      VariableDeclarator(path) {
        const init = path.node.init;
        if (!init || !t.isCallExpression(init)) return;
        if (!t.isFunctionExpression(init.callee)) return;
        const body = init.callee.body;
        if (!t.isBlockStatement(body) || !isCallControllerBody(body)) return;
        if (!t.isIdentifier(path.node.id)) return;
        const binding = path.scope.getBinding(path.node.id.name);
        if (!binding) return;
        controllers.push({ initPath: path, name: path.node.id.name, binding });
      },
    });

    if (controllers.length === 0) {
      report.note('no self-defending controllers found');
      return;
    }

    let neutralized = 0;
    for (const controller of controllers) {
      // Plan before mutating: refs are collected up front, each processed once.
      const callSites = [];
      const otherRefs = [];
      for (const ref of controller.binding.referencePaths) {
        const parent = ref.parentPath;
        if (parent?.isCallExpression()) {
          if (parent.node.callee === ref.node) {
            // Direct application: ctrl(this, payload) -> guarded function
            callSites.push(parent);
          } else if (parent.node.arguments[0] === ref.node) {
            // Indirect application through a decoy helper:
            // helper(ctrl, payload) where the helper is `function (a, b) { return a(b); }`
            // :  the whole call produces the guarded function.
            callSites.push(parent);
          } else {
            otherRefs.push(ref);
          }
        } else {
          otherRefs.push(ref);
        }
      }

      const replaceWithNoop = (targetPath) => {
        const replacement = noopFn();
        if (annotate) {
          t.addComment(replacement, 'leading', ' [disarm] Neutralized self-defending anti-tamper check', true);
        }
        targetPath.replaceWith(replacement);
      };

      // ctrl(this, payload) -> a no-op function literal (payload leaves the tree).
      for (const call of callSites) {
        try {
          replaceWithNoop(call);
          neutralized++;
        } catch {
          // already detached
        }
      }
      // Any other consumption of the controller gets a no-op too.
      for (const ref of otherRefs) {
        try {
          replaceWithNoop(ref);
          neutralized++;
        } catch {
          // already detached
        }
      }
      // The controller itself becomes a factory handing out no-op functions,
      // so even undiscovered references keep working.
      try {
        controller.initPath.node.init = noopFactory();
        neutralized++;
      } catch {
        // already detached
      }
    }

    report.count(neutralized);
    report.note(`neutralized ${controllers.length} controller(s)`);
  },
};
