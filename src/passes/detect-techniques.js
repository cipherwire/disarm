import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
import { JUNK_NAME_RE, hasLocalBinding, isAllStringArray } from '../utils/ast.js';

const traverse = traverseModule.default ?? traverseModule;

/** while (true) / for (;;) whose body contains a switch: flattener state machine. */
function isDispatchLoop(node) {
  const infinite =
    (t.isWhileStatement(node) &&
      (!node.test ||
        (t.isBooleanLiteral(node.test) && node.test.value === true) ||
        (t.isNumericLiteral(node.test) && node.test.value !== 0))) ||
    (t.isForStatement(node) && !node.test);
  if (!infinite) return false;
  return t.isBlockStatement(node.body) && node.body.body.some((statement) => t.isSwitchStatement(statement));
}

/** Manual scan for the SingleCallController shape obfuscators use for self-defending code. */
function isCallControllerBody(body) {
  let hasApply = false;
  let hasNullAssign = false;
  let hasTrueFlag = false;
  let hasFalseAssign = false;
  const isTrueShape = (node) =>
    (t.isBooleanLiteral(node) && node.value === true) ||
    (t.isUnaryExpression(node) && node.operator === '!' &&
      t.isUnaryExpression(node.argument) && node.argument.operator === '!' &&
      t.isArrayExpression(node.argument.argument) && node.argument.argument.elements.length === 0);
  const isFalseShape = (node) =>
    (t.isBooleanLiteral(node) && node.value === false) ||
    (t.isUnaryExpression(node) && node.operator === '!' &&
      t.isArrayExpression(node.argument) && node.argument.elements.length === 0);
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

/**
 * Read-only first pass: fingerprint which obfuscation techniques the script
 * uses and record them in the report. Nothing is modified :  this is the
 * "who made this and how" manifest that makes every unmask output auditable.
 */
export const detectTechniques = {
  name: 'detect-techniques',
  description: 'Fingerprint obfuscation techniques into report.meta.techniques (read-only).',
  run(ast, report) {
    const counts = new Map();
    const bump = (name, n = 1) => counts.set(name, (counts.get(name) ?? 0) + n);

    traverse(ast, {
      ArrayExpression(path) {
        if (isAllStringArray(path.node)) bump('string-array-literal');
      },
      NewExpression(path) {
        const callee = path.node.callee;
        if (t.isMemberExpression(callee) && !callee.computed &&
            path.node.arguments.length === 1 && t.isStringLiteral(path.node.arguments[0])) {
          bump('string-bank-constructor');
        }
      },
      DebuggerStatement() {
        bump('debugger-statement');
      },
      'CallExpression|NewExpression'(path) {
        const callee = path.node.callee;
        const isFunctionCtor =
          (t.isIdentifier(callee) && callee.name === 'Function' && !hasLocalBinding(path, 'Function')) ||
          (t.isMemberExpression(callee) &&
            ((t.isIdentifier(callee.property) && callee.property.name === 'constructor') ||
              (t.isStringLiteral(callee.property) && callee.property.value === 'constructor')));
        if (isFunctionCtor && path.node.arguments.length > 0) {
          bump('function-ctor-call');
        }
        if (t.isIdentifier(callee) && callee.name === 'eval' && !hasLocalBinding(path, 'eval')) {
          bump('eval-call');
        }
      },
      UnaryExpression(path) {
        const argument = path.node.argument;
        if (t.isArrayExpression(argument) && argument.elements.length === 0 &&
            (path.node.operator === '!' || path.node.operator === '+')) {
          bump('coercion-trick');
        }
        if (path.node.operator === 'void' && t.isNumericLiteral(argument)) {
          bump('coercion-trick');
        }
      },
      MemberExpression(path) {
        const node = path.node;
        if (node.computed && t.isArrayExpression(node.object) && node.object.elements.length === 0 &&
            t.isArrayExpression(node.property)) {
          bump('coercion-trick');
        }
      },
      'WhileStatement|ForStatement'(path) {
        if (isDispatchLoop(path.node)) bump('switch-dispatch-loop');
      },
      ConditionalExpression(path) {
        if (t.isCallExpression(path.node.consequent) && t.isNullLiteral(path.node.alternate)) {
          bump('guarded-decoder-call');
        }
      },
      Identifier(path) {
        if (JUNK_NAME_RE.test(path.node.name)) bump('junk-identifier');
      },
      'FunctionDeclaration|FunctionExpression'(path) {
        if (isCallControllerBody(path.node.body)) bump('call-controller-shape');
      },
    });

    report.meta.techniques = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    report.note(
      report.meta.techniques.length > 0
        ? `techniques: ${report.meta.techniques.map((entry) => `${entry.name}×${entry.count}`).join(', ')}`
        : 'techniques: none detected',
    );
  },
};
