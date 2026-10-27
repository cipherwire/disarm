import traverseModule from '@babel/traverse';
import * as t from '@babel/types';

const traverse = traverseModule.default ?? traverseModule;

/**
 * Resolve an array of step keys from an AST node:
 *   - "3|1|4|2|0".split("|") -> ['3', '1', '4', '2', '0']
 *   - ['3', '1', '4', '2', '0'] -> ['3', '1', '4', '2', '0']
 */
function resolveSequence(node) {
  if (!node) return null;
  // "3|1|4".split("|")
  if (
    t.isCallExpression(node) &&
    t.isMemberExpression(node.callee) &&
    !node.callee.computed &&
    t.isIdentifier(node.callee.property) &&
    node.callee.property.name === 'split' &&
    t.isStringLiteral(node.callee.object) &&
    node.arguments.length === 1 &&
    t.isStringLiteral(node.arguments[0])
  ) {
    return node.callee.object.value.split(node.arguments[0].value);
  }

  // ['3', '1', '4'] or [3, 1, 4]
  if (t.isArrayExpression(node)) {
    const list = [];
    for (const elem of node.elements) {
      if (t.isStringLiteral(elem) || t.isNumericLiteral(elem)) {
        list.push(String(elem.value));
      } else {
        return null;
      }
    }
    return list;
  }

  return null;
}

/**
 * Unflatten switch-dispatch control flow loops into linear sequential statements.
 *
 * Anti-bot scripts (Akamai, Cloudflare Turnstile, DataDome, Shape) and
 * javascript-obfuscator scramble linear code blocks into a state machine:
 *
 *   var seq = "2|0|1".split("|"), idx = 0;
 *   while (true) {
 *     switch (seq[idx++]) {
 *       case "0": b(); continue;
 *       case "1": c(); continue;
 *       case "2": a(); continue;
 *     }
 *     break;
 *   }
 *
 * This pass reconstructs the execution order ['2', '0', '1'] and replaces
 * the entire dispatch loop with linear sequential statements: a(); b(); c();
 */
export const unflattenControlFlow = {
  name: 'unflatten-control-flow',
  description: 'Reconstruct linear execution order from switch-dispatch state machine loops.',
  run(ast, report, context) {
    let unflattened = 0;

    traverse(ast, {
      'WhileStatement|ForStatement'(path) {
        const node = path.node;
        const isInfinite =
          (t.isWhileStatement(node) &&
            (!node.test ||
              (t.isBooleanLiteral(node.test) && node.test.value === true) ||
              (t.isNumericLiteral(node.test) && node.test.value !== 0) ||
              (t.isUnaryExpression(node.test) &&
                node.test.operator === '!' &&
                t.isNumericLiteral(node.test.argument) &&
                node.test.argument.value === 0))) ||
          (t.isForStatement(node) && !node.test);

        if (!isInfinite || !t.isBlockStatement(node.body)) return;

        // Locate the SwitchStatement inside the loop body
        const switchIndex = node.body.body.findIndex((stmt) => t.isSwitchStatement(stmt));
        if (switchIndex === -1) return;
        const switchNode = node.body.body[switchIndex];

        // Discriminant must be member access on an array: seq[idx++] or seq[idx]
        const disc = switchNode.discriminant;
        if (!t.isMemberExpression(disc) || !t.isIdentifier(disc.object)) return;
        const arrayName = disc.object.name;

        let indexName = null;
        if (t.isUpdateExpression(disc.property) && t.isIdentifier(disc.property.argument)) {
          indexName = disc.property.argument.name;
        } else if (t.isIdentifier(disc.property)) {
          indexName = disc.property.name;
        }

        // Trace array binding to find sequence definition
        const arrayBinding = path.scope.getBinding(arrayName);
        if (!arrayBinding || !arrayBinding.path.isVariableDeclarator()) return;
        const arrayInit = arrayBinding.path.node.init;
        const sequence = resolveSequence(arrayInit);

        if (!sequence || sequence.length === 0) return;

        // Map switch cases by stringified key
        const caseMap = new Map();
        for (const switchCase of switchNode.cases) {
          if (!switchCase.test) continue;
          let caseKey = null;
          if (t.isStringLiteral(switchCase.test) || t.isNumericLiteral(switchCase.test)) {
            caseKey = String(switchCase.test.value);
          }
          if (caseKey !== null) {
            // Strip trailing continue or break statements
            const statements = switchCase.consequent.filter(
              (s) => !t.isContinueStatement(s) && !t.isBreakStatement(s),
            );
            caseMap.set(caseKey, statements);
          }
        }

        // Verify that every step in the sequence has a matching case
        for (const key of sequence) {
          if (!caseMap.has(key)) return;
        }

        // Assemble statements in execution order
        const linearStatements = [];
        for (const key of sequence) {
          const statements = caseMap.get(key);
          for (const s of statements) {
            linearStatements.push(t.cloneNode(s, true));
          }
        }

        // Replace the dispatch loop with linear statements
        if (context?.options?.annotate && linearStatements.length > 0) {
          t.addComment(linearStatements[0], 'leading', ' [disarm] Reconstructed state machine control flow', true);
        }
        path.replaceWithMultiple(linearStatements);
        unflattened++;

        // Clean up array variable if it is only used for dispatch
        try {
          if (arrayBinding.referencePaths.length <= 1) {
            arrayBinding.path.remove();
          }
        } catch {
          // Ignored if already detached
        }

        if (indexName) {
          try {
            const indexBinding = path.scope.getBinding(indexName);
            if (indexBinding && indexBinding.referencePaths.length <= 1) {
              indexBinding.path.remove();
            }
          } catch {
            // Ignored if already detached
          }
        }
      },
    });

    report.count(unflattened);
    if (unflattened > 0) {
      report.note(`unflattened ${unflattened} control-flow dispatch loop(s)`);
    }
  },
};
