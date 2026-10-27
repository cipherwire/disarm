import traverseModule from '@babel/traverse';

const traverse = traverseModule.default ?? traverseModule;

const BRANCH_NODE_TYPES = new Set([
  'IfStatement',
  'ConditionalExpression',
  'SwitchCase',
  'LogicalExpression',
  'CatchClause',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
]);

const OPAQUE_IDENTIFIER_PATTERN = /^(_0x[a-f0-9]+|[a-zA-Z0-9]{1,2}$)/i;

/**
 * Measure structural code complexity and obfuscation density directly on the AST.
 */
export function measureComplexity(ast) {
  let cyclomatic = 1;
  let nodeCount = 0;
  let totalIdentifiers = 0;
  let opaqueIdentifiers = 0;
  let maxDepth = 0;

  traverse(ast, {
    enter(path) {
      nodeCount++;
      const depth = (path.scope ? path.scope.depth : 0) + 1;
      if (depth > maxDepth) maxDepth = depth;

      if (BRANCH_NODE_TYPES.has(path.type)) {
        cyclomatic++;
      }

      if (path.isIdentifier()) {
        totalIdentifiers++;
        if (OPAQUE_IDENTIFIER_PATTERN.test(path.node.name)) {
          opaqueIdentifiers++;
        }
      }
    },
  });

  const opaqueRatio = totalIdentifiers > 0
    ? Math.round((opaqueIdentifiers / totalIdentifiers) * 100)
    : 0;

  return {
    cyclomatic,
    nodeCount,
    totalIdentifiers,
    opaqueIdentifiers,
    opaqueRatio,
    maxDepth,
  };
}

/**
 * Compute the differential impact of deobfuscation between initial and final ASTs.
 */
export function compareTelemetry(initial, final) {
  const cyclomaticDelta = initial.cyclomatic - final.cyclomatic;
  const cyclomaticDrop = initial.cyclomatic > 0
    ? Math.round((cyclomaticDelta / initial.cyclomatic) * 100)
    : 0;

  const nodeDelta = initial.nodeCount - final.nodeCount;
  const nodeReduction = initial.nodeCount > 0
    ? Math.round((nodeDelta / initial.nodeCount) * 100)
    : 0;

  const opaqueDelta = initial.opaqueIdentifiers - final.opaqueIdentifiers;
  const opaqueReduction = initial.opaqueIdentifiers > 0
    ? Math.round((opaqueDelta / initial.opaqueIdentifiers) * 100)
    : 0;

  // Composite readability index: 0-100 scale
  const readabilityScore = Math.min(
    100,
    Math.max(
      10,
      Math.round(
        50 +
        (cyclomaticDrop * 0.3) +
        (opaqueReduction * 0.4) +
        (nodeReduction * 0.3)
      )
    )
  );

  return {
    initial,
    final,
    cyclomaticDrop: Math.max(0, cyclomaticDrop),
    nodeReduction: Math.max(0, nodeReduction),
    opaqueReduction: Math.max(0, opaqueReduction),
    readabilityScore,
  };
}
