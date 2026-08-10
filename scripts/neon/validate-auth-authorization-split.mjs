import ts from "typescript";

const activeSources = [
  "authenticationService",
  "requestAuthentication",
  "productionAuthorization",
  "loginRoute",
  "sessionRoute",
  "initializationAccess",
  "neonImportStagingAuthorization",
];

export function validateAuthAuthorizationSplitSources(input) {
  validateNoSupabaseBusinessDrift(input);

  const contract = input.authenticationService;
  if (/\b(?:NeonPreAuthLoginIdentity|resolveLoginIdentity|readSessionAuthority)\b/.test(contract)) {
    throw new Error("RETIRED_PRE_AUTH_LOGIN_CONTRACT_DRIFT");
  }
  if (!/deriveDeterministicAuthEmail\s*\(/.test(contract) ||
      !/export\s+type\s*\{\s*NeonAuthorizationFacts\s*\}/.test(contract) ||
      !/resolveAuthorizationForAuthUser\s*\(\s*authUserId\s*:\s*string\s*,\s*hostname\s*:\s*string\s*,\s*requestId\s*:\s*string\s*\)/.test(contract)) {
    throw new Error("NEON_AUTHORIZATION_CONTRACT_DRIFT");
  }
  if (!/export\s+function\s+createLoginResolutionDependencies\b/.test(contract) ||
      !/export\s+async\s+function\s+resolveLoginWith\b/.test(contract)) {
    throw new Error("LOGIN_RESOLUTION_FACTORY_DRIFT");
  }
  if (!/export\s+function\s+createSessionResolutionDependencies\b/.test(input.requestAuthentication) ||
      !/export\s+async\s+function\s+resolveSessionWith\b/.test(input.requestAuthentication) ||
      !/resolveAuthenticatedRequestWithAuthority\b/.test(input.requestAuthentication)) {
    throw new Error("SESSION_RESOLUTION_FACTORY_DRIFT");
  }
  if (!/RuntimeDomainRegistry/.test(input.browserRegistry)) {
    throw new Error("BROWSER_REGISTRY_GATE_DRIFT");
  }
  return {
    deterministicLoginContract: true,
    neonAuthorizationContract: true,
    loginResolverFactory: true,
    sessionResolverFactory: true,
    serverOnlySupabaseBoundary: true,
    browserRegistryGate: true,
  };
}

function validateNoSupabaseBusinessDrift(input) {
  for (const sourceName of activeSources) {
    const source = input[sourceName] ?? "";
    auditActiveSourceSurface(source, sourceName);
  }
}

function auditActiveSourceSurface(source, sourceName) {
  if (/\b(?:NeonPreAuthLoginIdentity|resolveLoginIdentity|readSessionAuthority)\b/.test(source)) {
    throw new Error(`RETIRED_PRE_AUTH_LOGIN_CONTRACT_DRIFT:${sourceName}`);
  }

  const { sourceFile, checker } = createBindingAwareSource(source, sourceName);
  if (hasForbiddenSupabaseImport(sourceFile, checker)) {
    throw new Error(`SUPABASE_BUSINESS_AUTH_DRIFT:${sourceName}`);
  }
  const provenance = collectSupabaseClientProvenance(sourceFile, checker);
  if (hasUnsupportedSupabaseAuthUse(sourceFile, provenance)) {
    throw new Error(`SUPABASE_AUTH_METHOD_DRIFT:${sourceName}`);
  }
  if (hasInvalidActorFactoryUse(sourceFile, provenance)) {
    throw new Error(`SUPABASE_BUSINESS_AUTH_DRIFT:${sourceName}`);
  }
  if (sourceName === "neonImportStagingAuthorization" && hasSpoofedStorageAdapterBoundary(sourceFile)) {
    throw new Error(`SUPABASE_BUSINESS_AUTH_DRIFT:${sourceName}`);
  }
  const approvedStorageBinding = isApprovedStorageAdapterSource(sourceFile, sourceName)
    ? getApprovedStorageAdapterBinding(sourceFile, provenance)
    : null;
  if (isApprovedStorageAdapterSource(sourceFile, sourceName) && !approvedStorageBinding?.valid) {
    throw new Error(`SUPABASE_BUSINESS_AUTH_DRIFT:${sourceName}`);
  }
  const approvedStorageSource = Boolean(approvedStorageBinding?.valid);
  if (approvedStorageSource) {
    if (hasAdapterAliasFlow(sourceFile, approvedStorageBinding.parameterRoots) ||
        hasUnprovenSupabaseFlow(sourceFile, provenance) ||
        hasUnknownProvenanceAccess(sourceFile, provenance) ||
        hasUnknownImportedSupabaseSurface(sourceFile, provenance) ||
        hasUnknownImportedClientWrapperUse(sourceFile, provenance) ||
        hasUnknownImportedWrapperFlow(sourceFile, provenance) ||
        hasInvalidApprovedStorageClientSurface(sourceFile, approvedStorageBinding.parameterRoots) ||
        hasUnsupportedSupabaseStorageUse(sourceFile, provenance, sourceName) ||
        hasSupabaseBusinessUse(sourceFile, provenance) ||
        hasUnsupportedSupabaseClientSurface(sourceFile, provenance)) {
      throw new Error(`SUPABASE_BUSINESS_AUTH_DRIFT:${sourceName}`);
    }
    return;
  }
  const hasBusinessDrift = hasUnknownProvenanceAccess(sourceFile, provenance) ||
      hasUnknownImportedSupabaseSurface(sourceFile, provenance) ||
      hasUnknownImportedClientWrapperUse(sourceFile, provenance) ||
      hasUnknownImportedWrapperFlow(sourceFile, provenance) ||
      hasUnprovenSupabaseFlow(sourceFile, provenance) ||
      hasRecursiveClientLikeUse(sourceFile, provenance) ||
      hasUnsupportedSupabaseClientSurface(sourceFile, provenance) ||
      hasUnsupportedSupabaseStorageUse(sourceFile, provenance, sourceName) ||
      hasSupabaseBusinessUse(sourceFile, provenance) ||
      hasCyclicAliasGraph(sourceFile, provenance);
  if (provenance.unresolvedAliases || hasBusinessDrift) {
    throw new Error(`SUPABASE_BUSINESS_AUTH_DRIFT:${sourceName}`);
  }
}

function hasUnprovenSupabaseFlow(sourceFile, provenance) {
  let found = false;
  const mark = () => {
    found = true;
  };
  visitNodes(sourceFile, node => {
    if (found) return;

    if (ts.isCallExpression(node) &&
        !isFactoryReference(node.expression, provenance) &&
        !isGlobalPromiseAllCall(node, provenance.checker) &&
        !isApprovedStorageInputCall(node, sourceFile, provenance) &&
        !isApprovedStorageOperationCall(node, sourceFile) &&
        !isApprovedAuthDependencyCall(node, sourceFile) &&
        node.arguments.some(argument => valueCarriesProvenance(argument, provenance))) {
      mark(node);
      return;
    }

    if (ts.isBinaryExpression(node) &&
        [ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken,
          ts.SyntaxKind.QuestionQuestionEqualsToken].includes(node.operatorToken.kind) &&
        (valueCarriesProvenance(node.right, provenance) ||
          expressionHasTrackedProvenance(node.left, provenance))) {
      mark(node);
      return;
    }

    if (ts.isCallExpression(node) && isMemberAccess(node.expression)) {
      const receiver = unwrapExpression(node.expression.expression);
      const member = accessName(node.expression);
      if (member === "bind" || member === "call" || member === "apply") {
        if (isFactoryReference(receiver, provenance) ||
            expressionHasTrackedProvenance(receiver, provenance)) mark(node);
        return;
      }
      if (expressionHasTrackedProvenance(receiver, provenance) &&
          ["pop", "shift", "unshift", "push", "reverse", "splice", "at", "slice", "concat", "flat", "flatMap",
            "map", "filter", "find", "findLast", "findIndex", "reduce", "reduceRight",
            "forEach", "entries", "values", "keys", "toReversed", "toSorted", "toSpliced"]
            .includes(member)) {
        mark(node);
        return;
      }
    }

    if (ts.isNewExpression(node) && node.arguments?.some(argument =>
      valueCarriesProvenance(argument, provenance),
    )) {
      mark(node);
      return;
    }

    if (ts.isForOfStatement(node) && valueCarriesProvenance(node.expression, provenance)) {
      mark(node);
      return;
    }

    if (ts.isSpreadElement(node) && valueCarriesProvenance(node.expression, provenance)) {
      mark(node);
      return;
    }

    if ((ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) &&
        (node.body && containsSupabaseValue(node.body, provenance) ||
          node.parameters.some(parameter => valueCarriesProvenance(parameter, provenance)))) {
      mark(node);
      return;
    }

    if ((ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node) ||
         ts.isPropertySignature(node) || ts.isParameter(node) || ts.isBindingElement(node)) &&
        node.initializer && valueCarriesProvenance(node.initializer, provenance) &&
        !(ts.isPropertyAssignment(node) && isDirectFactoryCall(node.initializer, provenance) &&
          isApprovedAuthDependencyProperty(node, sourceFile)) &&
        !(ts.isPropertyAssignment(node) && isApprovedStorageOperationProperty(node, sourceFile))) {
      mark(node);
      return;
    }

    if (ts.isReturnStatement(node) && node.expression &&
        directlyCarriesSupabaseProvenance(node.expression, provenance) &&
        !isApprovedStorageResponseReturn(node, sourceFile)) {
      mark(node);
      return;
    }

    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
        node.body && !ts.isBlock(node.body) &&
        directlyCarriesSupabaseProvenance(node.body, provenance)) {
      mark(node);
      return;
    }

    if (ts.isVariableDeclaration(node) && node.initializer &&
        ((isFactoryReference(node.initializer, provenance) &&
          !isDirectFactoryCall(node.initializer, provenance)) ||
          (valueCarriesProvenance(node.initializer, provenance) &&
            !isDirectFactoryCall(node.initializer, provenance) &&
            !ts.isCallExpression(unwrapExpression(node.initializer))))) {
      mark(node);
      return;
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        valueCarriesProvenance(node.right, provenance) &&
        !isDirectFactoryCall(node.right, provenance)) {
      mark(node);
      return;
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        isMemberAccess(node.left) && valueCarriesProvenance(node.right, provenance)) mark(node);
  });
  return found;
}

function isGlobalPromiseAllCall(call, checker) {
  if (!ts.isCallExpression(call) || !isMemberAccess(call.expression) ||
      accessName(call.expression) !== "all") return false;
  const receiver = unwrapExpression(call.expression.expression);
  return ts.isIdentifier(receiver) && receiver.text === "Promise" &&
    !checker.getSymbolAtLocation(receiver);
}

function isApprovedAuthDependencyCall(node, sourceFile) {
  if (sourceFile.fileName !== "/authenticationService.ts" ||
      !ts.isIdentifier(unwrapExpression(node.expression)) ||
      unwrapExpression(node.expression).text !== "resolveLoginWith") return false;
  return isInsideNamedFunction(node, "resolveAccountForLogin");
}

function isApprovedStorageInputCall(node, sourceFile, provenance) {
  if (sourceFile.fileName !== "/neonImportStagingAuthorization.ts" ||
      !ts.isIdentifier(unwrapExpression(node.expression)) ||
      unwrapExpression(node.expression).text !== "createActorStorageGateway" ||
      node.arguments.length !== 1) return false;
  return isActorFactoryReference(node.arguments[0].expression, provenance) &&
    ts.isCallExpression(unwrapExpression(node.arguments[0])) &&
    hasActorTokenArgument(unwrapExpression(node.arguments[0]), provenance);
}

function isApprovedStorageOperationCall(node, sourceFile) {
  return sourceFile.fileName === "/neonImportStagingAuthorization.ts" &&
    ts.isIdentifier(unwrapExpression(node.expression)) &&
    unwrapExpression(node.expression).text === "operation" &&
    node.arguments.length === 1 &&
    ts.isObjectLiteralExpression(unwrapExpression(node.arguments[0])) &&
    unwrapExpression(node.arguments[0]).properties.some(property =>
      propertyNameText(property.name) === "storage",
    ) &&
    isInsideNamedFunction(node, "runAuthorizedNeonImportStaging");
}

function isApprovedAuthDependencyProperty(node, sourceFile) {
  let current = node.parent;
  while (current && current !== sourceFile) {
    if (ts.isCallExpression(current)) return isApprovedAuthDependencyCall(current, sourceFile);
    current = current.parent;
  }
  return false;
}

function isApprovedStorageOperationProperty(node, sourceFile) {
  if (sourceFile.fileName !== "/neonImportStagingAuthorization.ts" || !ts.isPropertyAssignment(node)) return false;
  let current = node.parent;
  while (current && current !== sourceFile) {
    if (ts.isCallExpression(current) && isApprovedStorageOperationCall(current, sourceFile)) return true;
    current = current.parent;
  }
  return false;
}

function isApprovedStorageResponseReturn(node, sourceFile) {
  if (sourceFile.fileName !== "/neonImportStagingAuthorization.ts" || !ts.isReturnStatement(node) ||
      !ts.isObjectLiteralExpression(unwrapExpression(node.expression))) return false;
  const properties = unwrapExpression(node.expression).properties;
  return isInsideNamedFunction(node, "runAuthorizedNeonImportStaging") &&
    properties.length === 2 &&
    properties.some(property => propertyNameText(property.name) === "data") &&
    properties.some(property => propertyNameText(property.name) === "headers");
}

function hasAdapterAliasFlow(sourceFile, parameterRoots = new Set()) {
  let found = false;
  visitNodes(sourceFile, node => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && node.initializer &&
        expressionHasBindingRoot(node.initializer, parameterRoots)) {
      found = true;
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        expressionHasBindingRoot(node.right, parameterRoots)) {
      found = true;
    }
  });
  return found;
}

function hasInvalidApprovedStorageClientSurface(sourceFile, parameterRoots = new Set()) {
  let found = false;
  visitNodes(sourceFile, node => {
    if (found || !isInsideApprovedStorageAdapter(node)) return;
    if (ts.isElementAccessExpression(node) && expressionHasBindingRoot(node.expression, parameterRoots)) {
      found = true;
      return;
    }
    if (!ts.isPropertyAccessExpression(node) || !expressionHasBindingRoot(node.expression, parameterRoots)) return;
    const receiver = unwrapExpression(node.expression);
    const member = node.name.text;
    if (node.questionDotToken) {
      found = true;
      return;
    }
    if (expressionHasBindingRoot(receiver, parameterRoots) && ts.isIdentifier(receiver)) {
      if (member !== "storage") {
        found = true;
      } else {
        const fromAccess = node.parent;
        if (!ts.isPropertyAccessExpression(fromAccess) || fromAccess.expression !== node ||
            fromAccess.name.text !== "from") found = true;
      }
      return;
    }
    if (ts.isPropertyAccessExpression(receiver) &&
        expressionHasBindingRoot(receiver.expression, parameterRoots) &&
        receiver.name.text === "storage") {
      if (member !== "from") {
        found = true;
      } else {
        const fromInvocation = node.parent;
        const terminalAccess = fromInvocation?.parent;
        const terminalInvocation = terminalAccess?.parent;
        if (!ts.isCallExpression(fromInvocation) || fromInvocation.expression !== node || fromInvocation.questionDotToken ||
            !ts.isPropertyAccessExpression(terminalAccess) || terminalAccess.expression !== fromInvocation || terminalAccess.questionDotToken ||
            !["upload", "download", "remove"].includes(terminalAccess.name.text) ||
            !ts.isCallExpression(terminalInvocation) || terminalInvocation.expression !== terminalAccess || terminalInvocation.questionDotToken ||
            !hasApprovedStorageTerminalArguments(terminalInvocation, terminalAccess.name.text)) found = true;
      }
      return;
    }
    if (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression) &&
        receiver.expression.name.text === "from" &&
        ts.isPropertyAccessExpression(receiver.expression.expression) &&
        expressionHasBindingRoot(receiver.expression.expression.expression, parameterRoots) &&
        receiver.expression.expression.name.text === "storage") {
      if (!(member === "upload" || member === "download" || member === "remove") ||
          !ts.isCallExpression(node.parent) || node.parent.expression !== node || node.parent.questionDotToken ||
          !hasApprovedStorageTerminalArguments(node.parent, member)) found = true;
      return;
    }
    found = true;
  });
  return found;
}

function hasApprovedStorageTerminalArguments(call, member) {
  if (member === "remove" || member === "download") return call.arguments.length === 1;
  return member === "upload" && call.arguments.length >= 2;
}

function hasSpoofedStorageAdapterBoundary(sourceFile) {
  let found = false;
  visitNodes(sourceFile, node => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === "createActorStorageGateway") {
      if (node.parent !== sourceFile ||
          !node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) found = true;
      return;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
        node.name.text === "createActorStorageGateway") found = true;
  });
  return found;
}

function expressionHasBindingRoot(node, roots) {
  if (!roots || roots.size === 0) return false;
  const expression = unwrapExpression(node);
  const identity = expressionIdentity(expression, roots.checker);
  if (identity && roots.has(identity.root)) return true;
  return false;
}

function hasRecursiveClientLikeUse(sourceFile, provenance) {
  const callableRoots = new Map();
  visitNodes(sourceFile, node => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const symbol = provenance.checker.getSymbolAtLocation(node.name);
      if (symbol) callableRoots.set(symbolBindingRoot(symbol), node);
      return;
    }
    if (ts.isVariableDeclaration(node) && node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
        ts.isIdentifier(node.name)) {
      const symbol = provenance.checker.getSymbolAtLocation(node.name);
      if (symbol) callableRoots.set(symbolBindingRoot(symbol), node.initializer);
    }
  });

  const edges = new Map();
  for (const [root, callable] of callableRoots) {
    const callees = new Set();
    for (const expression of functionReturnExpressions(callable)) {
      const value = unwrapExpression(expression);
      if (!ts.isCallExpression(value) || !ts.isIdentifier(value.expression)) continue;
      const symbol = provenance.checker.getSymbolAtLocation(value.expression);
      const calleeRoot = symbol && symbolBindingRoot(symbol);
      if (calleeRoot && callableRoots.has(calleeRoot)) callees.add(calleeRoot);
    }
    edges.set(root, callees);
  }

  const cyclic = new Set();
  for (const start of edges.keys()) {
    const path = [];
    const seen = new Map();
    const visit = current => {
      if (seen.has(current)) {
        for (let index = seen.get(current); index < path.length; index++) cyclic.add(path[index]);
        return;
      }
      if (!edges.has(current)) return;
      seen.set(current, path.length);
      path.push(current);
      for (const next of edges.get(current)) visit(next);
      path.pop();
      seen.delete(current);
    };
    visit(start);
  }
  if (cyclic.size === 0) return false;

  let found = false;
  visitNodes(sourceFile, node => {
    if (found || !isMemberAccess(node) ||
        !["from", "rpc", "auth", "storage"].includes(accessName(node))) return;
    const receiver = unwrapExpression(node.expression);
    if (!ts.isCallExpression(receiver) || !ts.isIdentifier(receiver.expression)) return;
    const symbol = provenance.checker.getSymbolAtLocation(receiver.expression);
    if (symbol && cyclic.has(symbolBindingRoot(symbol))) found = true;
  });
  return found;
}

function isDirectFactoryCall(node, provenance) {
  const expression = unwrapExpression(node);
  return ts.isCallExpression(expression) && isFactoryReference(expression.expression, provenance);
}

function directlyCarriesSupabaseProvenance(node, provenance) {
  const expression = unwrapExpression(node);
  if (ts.isIdentifier(expression)) {
    const declaration = provenance.checker.getSymbolAtLocation(expression)?.valueDeclaration;
    const initializer = declaration && ts.isVariableDeclaration(declaration) ? declaration.initializer : null;
    if (initializer && ts.isCallExpression(unwrapExpression(initializer))) {
      const call = unwrapExpression(initializer);
      return isFactoryReference(call.expression, provenance) ||
        isActorFactoryReference(call.expression, provenance);
    }
  }
  if (isFactoryReference(expression, provenance) ||
      isSupabaseClientExpression(expression, provenance) ||
      isActorClientExpression(expression, provenance)) return true;
  if (ts.isObjectLiteralExpression(expression) || ts.isArrayLiteralExpression(expression)) {
    return valueCarriesProvenance(expression, provenance);
  }
  return false;
}

function containsSupabaseValue(node, provenance) {
  let found = false;
  visitNodes(node, child => {
    if (found) return;
    if (ts.isReturnStatement(child) && child.expression && valueCarriesProvenance(child.expression, provenance)) {
      found = true;
    }
  });
  return found;
}

function hasCyclicAliasGraph(sourceFile, provenance) {
  const edges = new Map();
  visitNodes(sourceFile, node => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(unwrapExpression(node.left)) && ts.isIdentifier(unwrapExpression(node.right))) {
      const left = provenance.checker.getSymbolAtLocation(unwrapExpression(node.left));
      const right = provenance.checker.getSymbolAtLocation(unwrapExpression(node.right));
      if (left && right) edges.set(symbolBindingRoot(left), symbolBindingRoot(right));
    }
  });
  const cyclic = new Set();
  for (const start of edges.keys()) {
    const path = [];
    const seen = new Map();
    const visit = current => {
      if (seen.has(current)) {
        for (let index = seen.get(current); index < path.length; index++) cyclic.add(path[index]);
        return;
      }
      if (!edges.has(current)) return;
      seen.set(current, path.length);
      path.push(current);
      const next = edges.get(current);
      if (next) visit(next);
      path.pop();
      seen.delete(current);
    };
    visit(start);
  }
  return [...cyclic].some(root => {
      return [...provenanceBindingMaps(provenance)].some(bindings =>
        identityHasBinding(bindings, { root, path: "[]" }, true),
      );
    });
}

function hasForbiddenSupabaseImport(sourceFile, checker) {
  let found = false;
  visitNodes(sourceFile, node => {
    if (found) return;
    const moduleName = importedModuleName(node, checker);
    if (ts.isCallExpression(node) && node.arguments.length === 1 &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
         (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
        !ts.isStringLiteralLike(node.arguments[0])) {
      found = true;
      return;
    }
    if (moduleName && ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
         (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
        (isAllowedServerClientModule(moduleName) || isForbiddenSupabaseModule(moduleName))) {
      if (isExactApprovedDynamicFactoryImport(node, sourceFile)) return;
      found = true;
      return;
    }
    if (moduleName && isForbiddenSupabaseModule(moduleName)) {
      if (ts.isCallExpression(node) && isExactApprovedDynamicFactoryImport(node, sourceFile)) {
        return;
      }
      found = true;
      return;
    }
    if (ts.isImportEqualsDeclaration(node)) {
      const importEqualsModule = importedModuleName(node, checker);
      if (importEqualsModule &&
          (isAllowedServerClientModule(importEqualsModule) || isForbiddenSupabaseModule(importEqualsModule))) {
        found = true;
      }
      return;
    }
    if (ts.isImportDeclaration(node) &&
        ts.isStringLiteralLike(node.moduleSpecifier) &&
        isAllowedServerClientModule(node.moduleSpecifier.text) &&
        hasUnapprovedServerAdminImportShape(node.importClause)) {
      found = true;
      return;
    }
    if (ts.isImportDeclaration(node) &&
        ts.isStringLiteralLike(node.moduleSpecifier) &&
        isSupabaseBrowserModule(node.moduleSpecifier.text) &&
        importsBrowserClientFactory(node.importClause)) {
      found = true;
    }
  });
  return found;
}

function importedModuleName(node, checker) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  if (ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)) {
    return node.moduleReference.expression.text;
  }
  if (ts.isCallExpression(node) && node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
       (ts.isIdentifier(node.expression) &&
        node.expression.text === "require" &&
        !checker.getSymbolAtLocation(node.expression)))) {
    return node.arguments[0].text;
  }
  return null;
}

function importsBrowserClientFactory(importClause) {
  if (!importClause) return false;
  if (importClause.name && isBrowserClientFactoryName(importClause.name.text)) return true;
  const bindings = importClause.namedBindings;
  return Boolean(bindings && ts.isNamedImports(bindings) && bindings.elements.some(element =>
    isBrowserClientFactoryName((element.propertyName ?? element.name).text),
  ));
}

function isForbiddenSupabaseModule(value) {
  if (isAllowedServerClientModule(value)) return false;
  const normalized = normalizeModulePath(value);
  return normalized.startsWith("@supabase/") ||
    /(?:^|\/)repositories\/supabase(?:\/|$)/.test(normalized) ||
    /(?:^|\/)lib\/supabase(?:\/|$)/.test(normalized);
}

function normalizeModulePath(value) {
  const absolute = value.startsWith("/");
  const parts = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length > 0 && parts.at(-1) !== "..") {
      parts.pop();
    } else if (part !== "..") {
      parts.push(part);
    } else {
      parts.push(part);
    }
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}

function hasUnapprovedServerAdminImportShape(importClause) {
  if (!importClause) return false;
  if (importClause.name ||
      (importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings))) {
    return true;
  }
  const bindings = importClause.namedBindings;
  return Boolean(bindings && ts.isNamedImports(bindings) && bindings.elements.some(element =>
    !isServerClientFactoryName((element.propertyName ?? element.name).text),
  ));
}

function isExactApprovedDynamicFactoryImport(node, sourceFile) {
  if (sourceFile.fileName !== "/authenticationService.ts") return false;
  if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword ||
      node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0]) ||
      !isAllowedServerClientModule(node.arguments[0].text)) {
    return false;
  }
  let current = node.parent;
  while (current && current !== sourceFile) {
    if (ts.isArrayLiteralExpression(current) && current.parent && ts.isCallExpression(current.parent)) {
      const promiseAll = current.parent.expression;
      const receiver = isMemberAccess(promiseAll) ? unwrapExpression(promiseAll.expression) : null;
      if (isMemberAccess(promiseAll) && accessName(promiseAll) === "all" &&
          ts.isIdentifier(receiver) && receiver.text === "Promise" &&
          isInsideNamedFunction(node, "resolveAccountForLogin")) return true;
    }
    if (ts.isAwaitExpression(current) && current.parent &&
        (ts.isVariableDeclaration(current.parent) || ts.isPropertyAssignment(current.parent))) {
      return false;
    }
    current = current.parent;
  }
  return false;
}

function isInsideNamedFunction(node, functionName) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name?.text === functionName) return true;
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
        ts.isVariableDeclaration(current.parent) &&
        ts.isIdentifier(current.parent.name) && current.parent.name.text === functionName) return true;
    current = current.parent;
  }
  return false;
}

function isBrowserClientFactoryName(value) {
  return /^(?:createBrowserSupabaseClient|createBrowserClient|createClientComponentClient)$/.test(value);
}

function isSupabaseBrowserModule(value) {
  return value.startsWith("@supabase/") || /(?:^|[/-])supabase(?:[/-]|$)/i.test(value);
}

function createBindingAwareSource(source, sourceName) {
  const fileName = `/${sourceName}.ts`;
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const options = {
    module: ts.ModuleKind.ESNext,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
  };
  const host = {
    fileExists: candidate => candidate === fileName,
    getCanonicalFileName: candidate => candidate,
    getCurrentDirectory: () => "/",
    getDefaultLibFileName: () => "/lib.d.ts",
    getDirectories: () => [],
    getNewLine: () => "\n",
    getSourceFile: candidate => candidate === fileName ? sourceFile : undefined,
    readFile: candidate => candidate === fileName ? source : undefined,
    useCaseSensitiveFileNames: () => true,
    writeFile: () => {},
  };
  const program = ts.createProgram({ rootNames: [fileName], options, host });
  return { sourceFile: program.getSourceFile(fileName), checker: program.getTypeChecker() };
}

function collectSupabaseClientProvenance(sourceFile, checker) {
  const factories = new Map();
  const actorFactories = new Map();
  const namespaces = new Map();
  const receivers = new Map();
  const actorReceivers = new Map();
  const unknownImports = new Map();
  const provenance = {
    checker,
    factories,
    actorFactories,
    namespaces,
    receivers,
    actorReceivers,
    unknownImports,
    unresolvedAliases: false,
  };

  visitNodes(sourceFile, node => {
    if (ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteralLike(node.moduleReference.expression)) {
      if (isAllowedServerClientModule(node.moduleReference.expression.text)) {
        addExpressionBinding(namespaces, node.name, checker);
      } else {
        addExpressionBinding(unknownImports, node.name, checker);
      }
      return;
    }
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
    const importClause = node.importClause;
    if (!importClause || importClause.isTypeOnly) return;
    const allowedServerModule = isAllowedServerClientModule(node.moduleSpecifier.text);
    if (importClause.name) addExpressionBinding(unknownImports, importClause.name, checker);
    const bindings = importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;
        const importedName = (element.propertyName ?? element.name).text;
        if (allowedServerModule && isServerClientFactoryName(importedName)) {
          addExpressionBinding(factories, element.name, checker);
          if (importedName === "createServerActorClient") {
            addExpressionBinding(actorFactories, element.name, checker);
          }
        } else {
          addExpressionBinding(unknownImports, element.name, checker);
        }
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      if (allowedServerModule) addExpressionBinding(namespaces, bindings.name, checker);
      else addExpressionBinding(unknownImports, bindings.name, checker);
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    visitNodes(sourceFile, node => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        changed = propagateBinding(node.name, node.initializer, provenance) || changed;
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        changed = propagateAssignment(node.left, node.right, provenance) || changed;
      }
      if ((ts.isPropertyDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) &&
          node.initializer) {
        changed = propagateBinding(node.name, node.initializer, provenance) || changed;
      }
    });
  }

  return provenance;
}

function hasSupabaseBusinessUse(sourceFile, provenance) {
  let found = false;
  visitNodes(sourceFile, node => {
    if (found) return;
    if (isMemberAccess(node) &&
        ["from", "rpc"].includes(accessName(node)) &&
        isSupabaseClientExpression(node.expression, provenance)) {
      found = true;
      return;
    }
    if (ts.isVariableDeclaration(node) &&
        node.initializer &&
        isSupabaseClientExpression(node.initializer, provenance) &&
        bindingSelects(node.name, ["from", "rpc"])) {
      found = true;
      return;
    }
    if (ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        isSupabaseClientExpression(node.right, provenance) &&
        assignmentSelects(node.left, ["from", "rpc"])) {
      found = true;
    }
  });
  return found;
}

function hasUnsupportedSupabaseClientSurface(sourceFile, provenance) {
  const permittedSurfaces = new Set(["auth", "storage", "from", "rpc"]);
  let found = false;
  visitNodes(sourceFile, node => {
    if (found || !isMemberAccess(node) ||
        !isSupabaseClientExpression(node.expression, provenance)) {
      return;
    }
    const member = accessName(node);
    if (!member || !permittedSurfaces.has(member)) found = true;
  });
  return found;
}

function hasUnsupportedSupabaseStorageUse(sourceFile, provenance, sourceName) {
  const serverOnly = sourceHasServerOnlyImport(sourceFile);
  const approvedAdapter = isApprovedStorageAdapterSource(sourceFile, sourceName) &&
    getApprovedStorageAdapterBinding(sourceFile, provenance).valid;
  let found = false;
  visitNodes(sourceFile, node => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && node.initializer &&
        isSupabaseClientExpression(node.initializer, provenance) &&
        bindingSelects(node.name, ["storage"])) {
      found = true;
      return;
    }
    if (ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        isSupabaseClientExpression(node.right, provenance) &&
        assignmentSelects(node.left, ["storage"])) {
      found = true;
      return;
    }
    if (!isMemberAccess(node) ||
        accessName(node) !== "storage" ||
        !isSupabaseClientExpression(node.expression, provenance)) {
      return;
    }
    if (!isActorClientExpression(node.expression, provenance) ||
        !serverOnly ||
        !approvedAdapter ||
        !isInsideApprovedStorageAdapter(node) ||
        !ts.isPropertyAccessExpression(node) ||
        node.questionDotToken) {
      found = true;
      return;
    }
    const fromAccess = node.parent;
    const invocation = fromAccess.parent;
    if (!ts.isPropertyAccessExpression(fromAccess) ||
        fromAccess.expression !== node ||
        fromAccess.name.text !== "from" ||
        fromAccess.questionDotToken ||
        !ts.isCallExpression(invocation) ||
        invocation.expression !== fromAccess ||
        invocation.questionDotToken) {
      found = true;
      return;
    }
    const terminalAccess = invocation.parent;
    const terminalInvocation = terminalAccess.parent;
    if (!ts.isPropertyAccessExpression(terminalAccess) ||
        terminalAccess.expression !== invocation ||
        !["upload", "download", "remove"].includes(terminalAccess.name.text) ||
        terminalAccess.questionDotToken ||
        !ts.isCallExpression(terminalInvocation) ||
        terminalInvocation.expression !== terminalAccess ||
        terminalInvocation.questionDotToken) {
      found = true;
    }
  });
  return found;
}

function isApprovedStorageAdapterSource(sourceFile, sourceName) {
  if (sourceName !== "neonImportStagingAuthorization") return false;
  if (!sourceHasServerOnlyImport(sourceFile)) return false;
  return sourceFile.statements.some(statement =>
    ts.isFunctionDeclaration(statement) &&
    statement.name?.text === "createActorStorageGateway" &&
    statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

function getApprovedStorageAdapterBinding(sourceFile, provenance) {
  const approvedDeclaration = sourceFile.statements.find(statement =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "createActorStorageGateway" &&
    statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
  const approvedSymbol = approvedDeclaration?.name && provenance.checker.getSymbolAtLocation(approvedDeclaration.name);
  const parameterRoots = new Set();
  parameterRoots.checker = provenance.checker;
  const parameter = approvedDeclaration?.parameters?.[0];
  if (parameter?.name && ts.isIdentifier(parameter.name)) {
    const parameterSymbol = provenance.checker.getSymbolAtLocation(parameter.name);
    if (parameterSymbol) parameterRoots.add(symbolBindingRoot(parameterSymbol));
  }
  let found = false;
  visitNodes(sourceFile, node => {
    if (found || !ts.isCallExpression(node) ||
        !ts.isIdentifier(unwrapExpression(node.expression)) ||
        unwrapExpression(node.expression).text !== "createActorStorageGateway" ||
        node.arguments.length !== 1 || !approvedSymbol) return;
    const callSymbol = provenance.checker.getSymbolAtLocation(unwrapExpression(node.expression));
    if (!callSymbol || symbolBindingRoot(callSymbol) !== symbolBindingRoot(approvedSymbol)) return;
    found = isActorClientExpression(node.arguments[0], provenance);
  });
  return { valid: found && parameterRoots.size > 0, parameterRoots };
}

function hasInvalidActorFactoryUse(sourceFile, provenance) {
  let found = false;
  visitNodes(sourceFile, node => {
    if (found || !ts.isCallExpression(node) ||
        !isActorFactoryReference(node.expression, provenance)) return;
    if (!hasActorTokenArgument(node, provenance)) found = true;
  });
  return found;
}

function sourceHasServerOnlyImport(sourceFile) {
  return sourceFile.statements.some(statement =>
    ts.isImportDeclaration(statement) &&
    ts.isStringLiteralLike(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text === "server-only",
  );
}

function isInsideApprovedStorageAdapter(node) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name?.text === "createActorStorageGateway" &&
        current.parent && ts.isSourceFile(current.parent) &&
        current.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      return true;
    }
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
        ts.isVariableDeclaration(current.parent) &&
        ts.isIdentifier(current.parent.name) &&
        current.parent.name.text === "createActorStorageGateway" &&
        current.parent.parent && ts.isVariableStatement(current.parent.parent) &&
        current.parent.parent.parent && ts.isSourceFile(current.parent.parent.parent) &&
        current.parent.parent.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function hasUnsupportedSupabaseAuthUse(sourceFile, provenance) {
  const allowedMethods = new Set(["signInWithPassword", "getUser", "refreshSession"]);
  let found = false;
  visitNodes(sourceFile, node => {
    if (found) return;
    if (ts.isVariableDeclaration(node) &&
        node.initializer &&
        isSupabaseClientExpression(node.initializer, provenance) &&
        bindingSelects(node.name, ["auth"])) {
      found = true;
      return;
    }
    if (ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        isSupabaseClientExpression(node.right, provenance) &&
        assignmentSelects(node.left, ["auth"])) {
      found = true;
      return;
    }
    if (!isMemberAccess(node) ||
        accessName(node) !== "auth" ||
        !isSupabaseClientExpression(node.expression, provenance)) {
      return;
    }
    if (!ts.isPropertyAccessExpression(node) || node.questionDotToken) {
      found = true;
      return;
    }
    const methodAccess = node.parent;
    const invocation = methodAccess.parent;
    if (!ts.isPropertyAccessExpression(methodAccess) ||
        methodAccess.expression !== node ||
        methodAccess.questionDotToken ||
        !allowedMethods.has(methodAccess.name.text) ||
        !ts.isCallExpression(invocation) ||
        invocation.expression !== methodAccess ||
        invocation.questionDotToken) {
      found = true;
    }
  });
  return found;
}

function hasUnknownProvenanceAccess(sourceFile, provenance) {
  let found = false;
  visitNodes(sourceFile, node => {
    if (found || !ts.isElementAccessExpression(node) || accessName(node) !== null) return;
    const receiver = node.expression;
    if (isSupabaseClientExpression(receiver, provenance) ||
        isFactoryReference(receiver, provenance) ||
        isNamespaceExpression(receiver, provenance) ||
        expressionHasTrackedProvenance(receiver, provenance)) {
      found = true;
    }
  });
  return found;
}

function hasUnknownImportedSupabaseSurface(sourceFile, provenance) {
  let found = false;
  visitNodes(sourceFile, node => {
    if (found || !isMemberAccess(node) ||
        !["auth", "storage", "from", "rpc"].includes(accessName(node))) {
      return;
    }
    if (isUnknownImportedExpression(node.expression, provenance)) found = true;
  });
  return found;
}

function hasUnknownImportedClientWrapperUse(sourceFile, provenance) {
  let found = false;
  visitNodes(sourceFile, node => {
    if (found) return;
    if (ts.isCallExpression(node) && isUnknownImportedExpression(node.expression, provenance) &&
        isClientLikeImportedExpression(node.expression, provenance)) {
      found = true;
      return;
    }
    if (isMemberAccess(node) && isUnknownImportedExpression(node.expression, provenance) &&
        /^create(?:Browser|Client|Server|Supabase)/.test(accessName(node) ?? "")) {
      found = true;
    }
  });
  return found;
}

function hasUnknownImportedWrapperFlow(sourceFile, provenance) {
  const callableRoots = new Map();
  visitNodes(sourceFile, node => {
    let callable = null;
    let name = null;
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
      callable = node;
      name = node.name;
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      callable = node.initializer;
      name = node.name;
    }
    if (!callable || !name) return;
    const symbol = provenance.checker.getSymbolAtLocation(name);
    if (symbol) callableRoots.set(symbolBindingRoot(symbol), callable);
  });
  const wrapperRoots = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [root, callable] of callableRoots) {
      if (wrapperRoots.has(root)) continue;
      const isWrapper = functionReturnExpressions(callable).some(expression => {
        const value = unwrapExpression(expression);
        if (!ts.isCallExpression(value)) return false;
        if (isUnknownImportedExpression(value.expression, provenance)) return true;
        const callee = value.expression;
        if (ts.isIdentifier(callee) || isMemberAccess(callee)) {
          const symbol = provenance.checker.getSymbolAtLocation(callee);
          return Boolean(symbol && wrapperRoots.has(symbolBindingRoot(symbol)));
        }
        return false;
      });
      if (isWrapper) {
        wrapperRoots.add(root);
        changed = true;
      }
    }
  }
  if (wrapperRoots.size === 0) return false;
  let found = false;
  visitNodes(sourceFile, node => {
    if (found || !isMemberAccess(node) ||
        !["from", "rpc", "auth", "storage"].includes(accessName(node))) return;
    const receiver = unwrapExpression(node.expression);
    if (!ts.isCallExpression(receiver) ||
        (!ts.isIdentifier(receiver.expression) && !isMemberAccess(receiver.expression))) return;
    const symbol = provenance.checker.getSymbolAtLocation(receiver.expression);
    if (symbol && wrapperRoots.has(symbolBindingRoot(symbol))) found = true;
  });
  return found;
}

function isClientLikeImportedExpression(node, provenance) {
  const expression = unwrapExpression(node);
  const identity = expressionIdentity(expression, provenance.checker);
  if (!identity || !identityHasAncestorBinding(provenance.unknownImports, identity)) return false;
  const symbol = provenance.checker.getSymbolAtLocation(
    ts.isIdentifier(expression) ? expression : expression.expression,
  );
  const declarations = symbol?.declarations ?? [];
  return declarations.some(declaration => {
    const importDeclaration = declaration.parent?.parent;
    const moduleName = importDeclaration && ts.isImportDeclaration(importDeclaration)
      ? importDeclaration.moduleSpecifier.text
      : "";
    return /(?:client|supabase|storage|auth)/i.test(moduleName) ||
      /^(?:make|wrap|createBusiness|createWrapped)Client/i.test(declaration.name?.text ?? "");
  });
}

function isUnknownImportedExpression(node, provenance) {
  const expression = unwrapExpression(node);
  const identity = expressionIdentity(expression, provenance.checker);
  if (identity && identityHasAncestorBinding(provenance.unknownImports, identity)) return true;
  if (ts.isCallExpression(expression)) {
    if (expression.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(expression.expression) &&
         expression.expression.text === "require" &&
         !provenance.checker.getSymbolAtLocation(expression.expression))) {
      const moduleName = expression.arguments.length === 1 && ts.isStringLiteralLike(expression.arguments[0])
        ? expression.arguments[0].text
        : null;
      return !moduleName || !isAllowedServerClientModule(moduleName);
    }
    if (isUnknownImportedExpression(expression.expression, provenance)) return true;
  }
  return expressionAlternatives(expression).some(alternative =>
    isUnknownImportedExpression(alternative, provenance),
  );
}

function isDirectModuleLoadExpression(node, checker) {
  const expression = unwrapExpression(node);
  return ts.isCallExpression(expression) &&
    (expression.expression.kind === ts.SyntaxKind.ImportKeyword ||
     (ts.isIdentifier(expression.expression) &&
      expression.expression.text === "require" &&
      !checker.getSymbolAtLocation(expression.expression)));
}

function isSupabaseClientExpression(node, provenance) {
  const expression = unwrapExpression(node);
  if (hasExpressionBinding(provenance.receivers, expression, provenance.checker)) return true;
  if (ts.isCallExpression(expression) && isFactoryReference(expression.expression, provenance)) return true;
  if (ts.isCallExpression(expression) && expression.arguments.some(argument =>
    valueCarriesProvenance(argument, provenance),
  )) {
    return true;
  }
  return expressionAlternatives(expression).some(alternative =>
    isSupabaseClientExpression(alternative, provenance),
  );
}

function isActorClientExpression(node, provenance) {
  const expression = unwrapExpression(node);
  if (hasExpressionBinding(provenance.actorReceivers, expression, provenance.checker)) return true;
  if (ts.isCallExpression(expression) &&
      hasActorTokenArgument(expression, provenance) &&
      isActorFactoryReference(expression.expression, provenance)) return true;
  return expressionAlternatives(expression).some(alternative =>
    isActorClientExpression(alternative, provenance),
  );
}

function hasActorTokenArgument(call, provenance) {
  if (call.arguments.length !== 1) return false;
  return isViableActorToken(call.arguments[0], provenance, new Set());
}

function isViableActorToken(value, provenance, seen) {
  const token = unwrapExpression(value);
  if (ts.isIdentifier(token)) {
    if (!/^(?:access[_]?token|actor[_]?token)$/i.test(token.text)) return false;
    const symbol = provenance?.checker?.getSymbolAtLocation(token);
    const declaration = symbol?.valueDeclaration;
    if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer) return true;
    const root = symbolBindingRoot(symbol);
    if (seen.has(root)) return false;
    seen.add(root);
    return isViableActorToken(declaration.initializer, provenance, seen);
  }
  if (isMemberAccess(token)) {
    return /^(?:access[_]?token|actor[_]?token)$/i.test(accessName(token) ?? "");
  }
  return false;
}

function isFactoryReference(node, provenance) {
  const expression = unwrapExpression(node);
  if (hasExpressionBinding(provenance.factories, expression, provenance.checker)) return true;
  if (isMemberAccess(expression) &&
      isServerClientFactoryName(accessName(expression)) &&
      isNamespaceExpression(expression.expression, provenance)) {
    return true;
  }
  return expressionAlternatives(expression).some(alternative =>
    isFactoryReference(alternative, provenance),
  );
}

function isActorFactoryReference(node, provenance) {
  const expression = unwrapExpression(node);
  if (hasExpressionBinding(provenance.actorFactories, expression, provenance.checker)) return true;
  if (isMemberAccess(expression) &&
      accessName(expression) === "createServerActorClient" &&
      isNamespaceExpression(expression.expression, provenance)) {
    return true;
  }
  return expressionAlternatives(expression).some(alternative =>
    isActorFactoryReference(alternative, provenance),
  );
}

function isNamespaceExpression(node, provenance) {
  const expression = unwrapExpression(node);
  if (hasExpressionBinding(provenance.namespaces, expression, provenance.checker) ||
      isAllowedServerClientImportExpression(expression, provenance.checker)) {
    return true;
  }
  return expressionAlternatives(expression).some(alternative =>
    isNamespaceExpression(alternative, provenance),
  );
}

function functionReturnExpressions(callable) {
  if (!ts.isBlock(callable.body)) return [callable.body];
  const returned = [];
  const visit = node => {
    if (node !== callable.body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      returned.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(callable.body);
  return returned;
}

function expressionAlternatives(node) {
  const expression = unwrapExpression(node);
  if (ts.isConditionalExpression(expression)) {
    return [expression.whenTrue, expression.whenFalse];
  }
  if (ts.isBinaryExpression(expression)) {
    if (expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) return [expression.right];
    if ([
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(expression.operatorToken.kind)) {
      return [expression.left, expression.right];
    }
    if (expression.operatorToken.kind === ts.SyntaxKind.CommaToken) return [expression.right];
  }
  return [];
}

function propagateBinding(target, value, provenance) {
  if (ts.isObjectBindingPattern(target)) {
    return propagateObjectBinding(target, value, provenance);
  }
  if (ts.isArrayBindingPattern(target)) {
    return propagateArrayBinding(target, value, provenance);
  }
  return propagateExpressionBinding(target, value, provenance);
}

function propagateAssignment(target, value, provenance) {
  const expression = unwrapExpression(target);
  if (ts.isObjectLiteralExpression(expression)) {
    return propagateObjectAssignment(expression, value, provenance);
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return propagateArrayAssignment(expression, value, provenance);
  }
  return propagateExpressionBinding(expression, value, provenance);
}

function propagateExpressionBinding(target, value, provenance) {
  const identity = expressionIdentity(target, provenance.checker);
  if (!identity) {
    if (valueCarriesProvenance(value, provenance)) provenance.unresolvedAliases = true;
    return false;
  }
  return propagateValueToIdentity(identity, value, provenance);
}

function propagateValueToIdentity(targetIdentity, value, provenance) {
  const expression = unwrapExpression(value);
  let changed = false;
  const alternatives = expressionAlternatives(expression);
  if (alternatives.length > 0) {
    for (const alternative of alternatives) {
      changed = propagateValueToIdentity(targetIdentity, alternative, provenance) || changed;
    }
    return changed;
  }
  if (ts.isObjectLiteralExpression(expression)) {
    changed = propagateObjectLiteral(targetIdentity, expression, provenance) || changed;
  }
  if (ts.isArrayLiteralExpression(expression)) {
    changed = propagateArrayLiteral(targetIdentity, expression, provenance) || changed;
  }
  const sourceIdentity = expressionIdentity(expression, provenance.checker);
  if (sourceIdentity) {
    changed = copyIdentityProvenance(targetIdentity, sourceIdentity, provenance) || changed;
  }
  if (isFactoryReference(expression, provenance)) {
    changed = addIdentityBinding(provenance.factories, targetIdentity) || changed;
  }
  if (isActorFactoryReference(expression, provenance)) {
    changed = addIdentityBinding(provenance.actorFactories, targetIdentity) || changed;
  }
  if (isNamespaceExpression(expression, provenance)) {
    changed = addIdentityBinding(provenance.namespaces, targetIdentity) || changed;
  }
  if (isSupabaseClientExpression(expression, provenance)) {
    changed = addIdentityBinding(provenance.receivers, targetIdentity) || changed;
  }
  if (isActorClientExpression(expression, provenance)) {
    changed = addIdentityBinding(provenance.actorReceivers, targetIdentity) || changed;
  }
  if (isUnknownImportedExpression(expression, provenance)) {
    changed = addIdentityBinding(provenance.unknownImports, targetIdentity) || changed;
  }
  return changed;
}

function propagateArrayLiteral(targetIdentity, arrayLiteral, provenance) {
  let changed = false;
  arrayLiteral.elements.forEach((element, index) => {
    if (ts.isSpreadElement(element)) {
      if (valueCarriesProvenance(element.expression, provenance)) provenance.unresolvedAliases = true;
      return;
    }
    changed = propagateValueToIdentity(
      appendIdentityPath(targetIdentity, String(index)),
      element,
      provenance,
    ) || changed;
  });
  return changed;
}

function propagateObjectLiteral(targetIdentity, objectLiteral, provenance) {
  let changed = false;
  for (const property of objectLiteral.properties) {
    if (ts.isSpreadAssignment(property)) {
      const sourceIdentity = expressionIdentity(property.expression, provenance.checker);
      if (sourceIdentity) {
        changed = copyIdentityProvenance(targetIdentity, sourceIdentity, provenance) || changed;
      } else if (valueCarriesProvenance(property.expression, provenance)) {
        provenance.unresolvedAliases = true;
      }
      continue;
    }
    if (!ts.isShorthandPropertyAssignment(property) && !ts.isPropertyAssignment(property)) continue;
    const propertyName = propertyNameText(property.name);
    const propertyValue = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
    if (!propertyName) {
      if (valueCarriesProvenance(propertyValue, provenance)) provenance.unresolvedAliases = true;
      continue;
    }
    changed = propagateValueToIdentity(
      appendIdentityPath(targetIdentity, propertyName),
      propertyValue,
      provenance,
    ) || changed;
  }
  return changed;
}

function propagateObjectBinding(pattern, value, provenance) {
  const expression = unwrapExpression(value);
  const alternatives = expressionAlternatives(expression);
  if (alternatives.length > 0) {
    return alternatives.reduce(
      (changed, alternative) => propagateObjectBinding(pattern, alternative, provenance) || changed,
      false,
    );
  }
  if (isDirectModuleLoadExpression(expression, provenance.checker) &&
      isUnknownImportedExpression(expression, provenance)) {
    return propagateUnknownImportPattern(pattern, provenance);
  }
  if (isSupabaseClientExpression(expression, provenance) ||
      isUnknownImportedExpression(expression, provenance)) {
    provenance.unresolvedAliases = true;
    return false;
  }
  let changed = false;
  const sourceIdentity = expressionIdentity(expression, provenance.checker);
  for (const element of pattern.elements) {
    if (element.dotDotDotToken) {
      if (valueCarriesProvenance(expression, provenance) ||
          (sourceIdentity && identityHasTrackedProvenance(sourceIdentity, provenance, true))) {
        provenance.unresolvedAliases = true;
      }
      continue;
    }
    const propertyName = propertyNameText(element.propertyName ?? element.name);
    if (!propertyName) {
      if (valueCarriesProvenance(expression, provenance)) provenance.unresolvedAliases = true;
      continue;
    }
    const literalValue = ts.isObjectLiteralExpression(expression)
      ? objectLiteralPropertyValue(expression, propertyName)
      : null;
    if (literalValue) {
      changed = propagateBinding(element.name, literalValue, provenance) || changed;
    } else if (sourceIdentity) {
      changed = propagateIdentityToBinding(
        element.name,
        appendIdentityPath(sourceIdentity, propertyName),
        provenance,
      ) || changed;
    }
    if (isNamespaceExpression(expression, provenance) &&
        isServerClientFactoryName(propertyName)) {
      changed = addExpressionBinding(provenance.factories, element.name, provenance.checker) || changed;
      if (propertyName === "createServerActorClient") {
        changed = addExpressionBinding(provenance.actorFactories, element.name, provenance.checker) || changed;
      }
    }
    if (element.initializer) {
      changed = propagateBinding(element.name, element.initializer, provenance) || changed;
    }
  }
  return changed;
}

function propagateObjectAssignment(pattern, value, provenance) {
  const expression = unwrapExpression(value);
  const alternatives = expressionAlternatives(expression);
  if (alternatives.length > 0) {
    return alternatives.reduce(
      (changed, alternative) => propagateObjectAssignment(pattern, alternative, provenance) || changed,
      false,
    );
  }
  if (isDirectModuleLoadExpression(expression, provenance.checker) &&
      isUnknownImportedExpression(expression, provenance)) {
    let changed = false;
    for (const property of pattern.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        changed = addExpressionBinding(provenance.unknownImports, property.name, provenance.checker) || changed;
      } else if (ts.isPropertyAssignment(property)) {
        changed = addExpressionBinding(
          provenance.unknownImports,
          assignmentTarget(property.initializer),
          provenance.checker,
        ) || changed;
      }
    }
    return changed;
  }
  if (isSupabaseClientExpression(expression, provenance) ||
      isUnknownImportedExpression(expression, provenance)) {
    provenance.unresolvedAliases = true;
    return false;
  }
  let changed = false;
  const sourceIdentity = expressionIdentity(expression, provenance.checker);
  for (const property of pattern.properties) {
    if (ts.isSpreadAssignment(property)) {
      if (valueCarriesProvenance(expression, provenance)) provenance.unresolvedAliases = true;
      continue;
    }
    if (!ts.isShorthandPropertyAssignment(property) && !ts.isPropertyAssignment(property)) continue;
    const propertyName = propertyNameText(property.name);
    const target = ts.isShorthandPropertyAssignment(property)
      ? property.name
      : assignmentTarget(property.initializer);
    if (!propertyName) {
      if (valueCarriesProvenance(expression, provenance)) provenance.unresolvedAliases = true;
      continue;
    }
    const literalValue = ts.isObjectLiteralExpression(expression)
      ? objectLiteralPropertyValue(expression, propertyName)
      : null;
    if (literalValue) {
      changed = propagateExpressionBinding(target, literalValue, provenance) || changed;
    } else if (sourceIdentity) {
      changed = propagateIdentityToBinding(
        target,
        appendIdentityPath(sourceIdentity, propertyName),
        provenance,
      ) || changed;
    }
    if (isNamespaceExpression(expression, provenance) &&
        isServerClientFactoryName(propertyName)) {
      changed = addExpressionBinding(provenance.factories, target, provenance.checker) || changed;
      if (propertyName === "createServerActorClient") {
        changed = addExpressionBinding(provenance.actorFactories, target, provenance.checker) || changed;
      }
    }
  }
  return changed;
}

function propagateUnknownImportPattern(pattern, provenance) {
  let changed = false;
  for (const element of pattern.elements) {
    if (element.dotDotDotToken) {
      provenance.unresolvedAliases = true;
      continue;
    }
    if (ts.isIdentifier(element.name)) {
      changed = addExpressionBinding(provenance.unknownImports, element.name, provenance.checker) || changed;
    } else {
      changed = propagateUnknownImportPattern(element.name, provenance) || changed;
    }
  }
  return changed;
}

function propagateArrayBinding(pattern, value, provenance) {
  const expression = unwrapExpression(value);
  const sourceIdentity = expressionIdentity(expression, provenance.checker);
  const sourceElements = arrayValueElements(expression, provenance.checker);
  let changed = false;
  pattern.elements.forEach((element, index) => {
    if (!ts.isBindingElement(element)) return;
    if (element.dotDotDotToken) {
      if (valueCarriesProvenance(expression, provenance)) provenance.unresolvedAliases = true;
      return;
    }
    if (sourceElements?.[index]) {
      changed = propagateBinding(element.name, sourceElements[index], provenance) || changed;
    } else if (sourceIdentity) {
      changed = propagateIdentityToBinding(
        element.name,
        appendIdentityPath(sourceIdentity, String(index)),
        provenance,
      ) || changed;
    }
    if (element.initializer) {
      changed = propagateBinding(element.name, element.initializer, provenance) || changed;
    }
  });
  return changed;
}

function propagateArrayAssignment(pattern, value, provenance) {
  const expression = unwrapExpression(value);
  const sourceIdentity = expressionIdentity(expression, provenance.checker);
  const sourceElements = arrayValueElements(expression, provenance.checker);
  let changed = false;
  pattern.elements.forEach((element, index) => {
    if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
      if (ts.isSpreadElement(element) && valueCarriesProvenance(expression, provenance)) {
        provenance.unresolvedAliases = true;
      }
      return;
    }
    const target = assignmentTarget(element);
    if (sourceElements?.[index]) {
      changed = propagateExpressionBinding(target, sourceElements[index], provenance) || changed;
    } else if (sourceIdentity) {
      changed = propagateIdentityToBinding(
        target,
        appendIdentityPath(sourceIdentity, String(index)),
        provenance,
      ) || changed;
    }
  });
  return changed;
}

function arrayValueElements(expression, checker) {
  if (ts.isArrayLiteralExpression(expression)) return expression.elements;
  if (!ts.isCallExpression(expression) || expression.arguments.length !== 1 ||
      !ts.isArrayLiteralExpression(expression.arguments[0]) ||
      !isMemberAccess(expression.expression) ||
      accessName(expression.expression) !== "all") {
    return null;
  }
  const receiver = unwrapExpression(expression.expression.expression);
  if (!ts.isIdentifier(receiver) || receiver.text !== "Promise" || checker.getSymbolAtLocation(receiver)) {
    return null;
  }
  return expression.arguments[0].elements;
}

function propagateIdentityToBinding(target, sourceIdentity, provenance) {
  if (ts.isObjectBindingPattern(target)) {
    let changed = false;
    for (const element of target.elements) {
      if (element.dotDotDotToken) {
        if (identityHasTrackedProvenance(sourceIdentity, provenance, true)) {
          provenance.unresolvedAliases = true;
        }
        continue;
      }
      const propertyName = propertyNameText(element.propertyName ?? element.name);
      if (!propertyName) {
        if (identityHasTrackedProvenance(sourceIdentity, provenance, true)) {
          provenance.unresolvedAliases = true;
        }
        continue;
      }
      changed = propagateIdentityToBinding(
        element.name,
        appendIdentityPath(sourceIdentity, propertyName),
        provenance,
      ) || changed;
    }
    return changed;
  }
  if (ts.isArrayBindingPattern(target)) {
    let changed = false;
    target.elements.forEach((element, index) => {
      if (!ts.isBindingElement(element)) return;
      changed = propagateIdentityToBinding(
        element.name,
        appendIdentityPath(sourceIdentity, String(index)),
        provenance,
      ) || changed;
    });
    return changed;
  }
  const targetIdentity = expressionIdentity(target, provenance.checker);
  return targetIdentity ? copyIdentityProvenance(targetIdentity, sourceIdentity, provenance) : false;
}

function objectLiteralPropertyValue(objectLiteral, selectedName) {
  for (const property of objectLiteral.properties) {
    if (!ts.isShorthandPropertyAssignment(property) && !ts.isPropertyAssignment(property)) continue;
    if (propertyNameText(property.name) !== selectedName) continue;
    if (ts.isShorthandPropertyAssignment(property)) return property.name;
    if (ts.isPropertyAssignment(property)) return property.initializer;
  }
  return null;
}

function valueCarriesProvenance(value, provenance) {
  const expression = unwrapExpression(value);
  if (isFactoryReference(expression, provenance) ||
      isNamespaceExpression(expression, provenance) ||
      isSupabaseClientExpression(expression, provenance) ||
      expressionHasTrackedProvenance(expression, provenance)) {
    return true;
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.some(property => {
      if (ts.isSpreadAssignment(property)) return valueCarriesProvenance(property.expression, provenance);
      if (ts.isShorthandPropertyAssignment(property)) return valueCarriesProvenance(property.name, provenance);
      return ts.isPropertyAssignment(property) && valueCarriesProvenance(property.initializer, provenance);
    });
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.some(element =>
      ts.isSpreadElement(element)
        ? valueCarriesProvenance(element.expression, provenance)
        : valueCarriesProvenance(element, provenance),
    );
  }
  return expressionAlternatives(expression).some(alternative =>
    valueCarriesProvenance(alternative, provenance),
  );
}

function expressionHasTrackedProvenance(node, provenance) {
  const identity = expressionIdentity(node, provenance.checker);
  return Boolean(identity && identityHasTrackedProvenance(identity, provenance, true));
}

function identityHasTrackedProvenance(identity, provenance, includeDescendants) {
  return supabaseProvenanceBindingMaps(provenance).some(bindings =>
    identityHasBinding(bindings, identity, includeDescendants),
  );
}

function copyIdentityProvenance(targetIdentity, sourceIdentity, provenance) {
  let changed = false;
  for (const bindings of provenanceBindingMaps(provenance)) {
    const sourcePath = identityPath(sourceIdentity);
    const paths = bindings.get(sourceIdentity.root);
    if (!paths) continue;
    for (const encodedPath of paths) {
      const path = JSON.parse(encodedPath);
      if (!pathStartsWith(path, sourcePath)) continue;
      changed = addIdentityBinding(bindings, {
        root: targetIdentity.root,
        path: JSON.stringify([...identityPath(targetIdentity), ...path.slice(sourcePath.length)]),
      }) || changed;
    }
  }
  return changed;
}

function provenanceBindingMaps(provenance) {
  return [...supabaseProvenanceBindingMaps(provenance), provenance.unknownImports];
}

function supabaseProvenanceBindingMaps(provenance) {
  return [
    provenance.factories,
    provenance.actorFactories,
    provenance.namespaces,
    provenance.receivers,
    provenance.actorReceivers,
  ];
}

function addExpressionBinding(bindings, node, checker) {
  const identity = expressionIdentity(node, checker);
  return identity ? addIdentityBinding(bindings, identity) : false;
}

function addIdentityBinding(bindings, identity) {
  let paths = bindings.get(identity.root);
  if (!paths) {
    paths = new Set();
    bindings.set(identity.root, paths);
  }
  if (paths.has(identity.path)) return false;
  paths.add(identity.path);
  return true;
}

function hasExpressionBinding(bindings, node, checker) {
  const identity = expressionIdentity(node, checker);
  return Boolean(identity && bindings.get(identity.root)?.has(identity.path));
}

function identityHasBinding(bindings, identity, includeDescendants) {
  const expected = identityPath(identity);
  return Boolean([...bindings.get(identity.root) ?? []].some(encodedPath => {
    const actual = JSON.parse(encodedPath);
    return includeDescendants ? pathStartsWith(actual, expected) : encodedPath === identity.path;
  }));
}

function identityHasAncestorBinding(bindings, identity) {
  const actual = identityPath(identity);
  return Boolean([...bindings.get(identity.root) ?? []].some(encodedPath =>
    pathStartsWith(actual, JSON.parse(encodedPath)),
  ));
}

function appendIdentityPath(identity, member) {
  return {
    root: identity.root,
    path: JSON.stringify([...identityPath(identity), member]),
  };
}

function identityPath(identity) {
  return JSON.parse(identity.path);
}

function pathStartsWith(path, prefix) {
  return prefix.length <= path.length && prefix.every((member, index) => member === path[index]);
}

function expressionIdentity(node, checker) {
  let expression = unwrapExpression(node);
  const declarationIdentity = declaredPropertyIdentity(expression);
  if (declarationIdentity) return declarationIdentity;
  if (ts.isIdentifier(expression) &&
      ts.isShorthandPropertyAssignment(expression.parent) &&
      expression.parent.name === expression) {
    const valueSymbol = checker.getShorthandAssignmentValueSymbol(expression.parent);
    if (valueSymbol) return { root: symbolBindingRoot(valueSymbol), path: "[]" };
  }
  const path = [];
  while (isMemberAccess(expression)) {
    const member = accessName(expression);
    if (!member) return null;
    path.unshift(member);
    expression = unwrapExpression(expression.expression);
  }
  if (ts.isIdentifier(expression) || ts.isPrivateIdentifier(expression)) {
    const symbol = checker.getSymbolAtLocation(expression);
    return symbol ? { root: symbolBindingRoot(symbol), path: JSON.stringify(path) } : null;
  }
  if (expression.kind === ts.SyntaxKind.ThisKeyword) {
    return { root: thisBindingRoot(expression), path: JSON.stringify(path) };
  }
  return null;
}

function declaredPropertyIdentity(expression) {
  if ((ts.isIdentifier(expression) || ts.isPrivateIdentifier(expression) ||
       ts.isStringLiteralLike(expression) || ts.isComputedPropertyName(expression)) &&
      ts.isPropertyDeclaration(expression.parent) && expression.parent.name === expression) {
    const propertyName = propertyNameText(expression);
    if (!propertyName || !ts.isClassLike(expression.parent.parent)) return null;
    return { root: expression.parent.parent, path: JSON.stringify([propertyName]) };
  }
  return null;
}

function symbolBindingRoot(symbol) {
  return symbol.valueDeclaration ?? symbol.declarations?.[0] ?? symbol;
}

function thisBindingRoot(node) {
  let current = node.parent;
  while (current) {
    if (ts.isArrowFunction(current)) {
      current = current.parent;
      continue;
    }
    if (ts.isMethodDeclaration(current) || ts.isGetAccessorDeclaration(current) ||
        ts.isSetAccessorDeclaration(current) || ts.isConstructorDeclaration(current)) {
      return current.parent;
    }
    if (ts.isFunctionLike(current) || ts.isClassLike(current) || ts.isSourceFile(current)) {
      return current;
    }
    current = current.parent;
  }
  return node.getSourceFile();
}

function unwrapExpression(node) {
  let expression = node;
  while (ts.isParenthesizedExpression(expression) ||
         ts.isAsExpression(expression) ||
         ts.isTypeAssertionExpression(expression) ||
         ts.isNonNullExpression(expression) ||
         ts.isSatisfiesExpression(expression) ||
         ts.isAwaitExpression(expression)) {
    expression = expression.expression;
  }
  return expression;
}

function isMemberAccess(node) {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
}

function accessName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  const argument = unwrapExpression(node.argumentExpression);
  return ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument) ? argument.text : null;
}

function bindingSelects(name, members) {
  if (!ts.isObjectBindingPattern(name)) return false;
  return name.elements.some(element => {
    const selected = element.propertyName ?? element.name;
    return members.includes(propertyNameText(selected));
  });
}

function assignmentSelects(node, members) {
  const expression = unwrapExpression(node);
  if (!ts.isObjectLiteralExpression(expression)) return false;
  return expression.properties.some(property => {
    if (!ts.isShorthandPropertyAssignment(property) && !ts.isPropertyAssignment(property)) return false;
    return members.includes(propertyNameText(property.name));
  });
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) ||
      ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const expression = unwrapExpression(name.expression);
    return ts.isStringLiteralLike(expression) ? expression.text : null;
  }
  return null;
}

function assignmentTarget(node) {
  const expression = unwrapExpression(node);
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return expression.left;
  }
  return expression;
}

function isAllowedServerClientImportExpression(node, checker) {
  const expression = unwrapExpression(node);
  return ts.isCallExpression(expression) &&
    expression.arguments.length === 1 &&
    ts.isStringLiteral(expression.arguments[0]) &&
    (expression.expression.kind === ts.SyntaxKind.ImportKeyword ||
     (ts.isIdentifier(expression.expression) &&
      expression.expression.text === "require" &&
      !checker.getSymbolAtLocation(expression.expression))) &&
    isAllowedServerClientModule(expression.arguments[0].text);
}

function isAllowedServerClientModule(value) {
  return /(?:^|\/)lib\/supabase\/server-admin(?:\.ts)?$/.test(value);
}

function isServerClientFactoryName(value) {
  return /^createServer(?:Admin|Password|Actor)Client$/.test(value);
}

function visitNodes(node, visitor) {
  visitor(node);
  ts.forEachChild(node, child => visitNodes(child, visitor));
}

async function main() {
  if ((process.argv[2] ?? "source") !== "source") {
    throw new Error("AUTHORIZATION_SPLIT_SOURCE_VALIDATION_ONLY");
  }
  const root = new URL("../../", import.meta.url);
  const [
    authenticationService,
    requestAuthentication,
    productionAuthorization,
    loginRoute,
    sessionRoute,
    initializationAccess,
    neonImportStagingAuthorization,
    browserRegistry,
  ] = await Promise.all([
    read(root, "app/services/authentication-service.ts"),
    read(root, "app/services/request-authentication.ts"),
    read(root, "app/services/production-authorization.ts"),
    read(root, "app/api/auth/login/route.ts"),
    read(root, "app/api/auth/session/route.ts"),
    read(root, "app/api/initialization/access/route.ts"),
    read(root, "app/services/neon-import-staging-authorization.ts"),
    read(root, "app/repositories/runtime/neon-domain-registry.ts"),
  ]);
  console.log(JSON.stringify(validateAuthAuthorizationSplitSources({
    authenticationService,
    requestAuthentication,
    productionAuthorization,
    loginRoute,
    sessionRoute,
    initializationAccess,
    neonImportStagingAuthorization,
    browserRegistry,
  })));
}

async function read(root, path) {
  const { readFile } = await import("node:fs/promises");
  return readFile(new URL(path, root), "utf8");
}

const { pathToFileURL } = await import("node:url");
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "AUTHORIZATION_SPLIT_VALIDATION_UNKNOWN");
    process.exitCode = 1;
  });
}
