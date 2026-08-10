import ts from "typescript";

const activeSources = [
  "authenticationService",
  "requestAuthentication",
  "productionAuthorization",
  "loginRoute",
  "sessionRoute",
  "initializationAccess",
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
  if (/[@]supabase\/supabase-js|repositories\/supabase\//.test(source) ||
      /(?:lib\/supabase\/(?:browser|client)|createBrowserClient|createClientComponentClient)/.test(source)) {
    throw new Error(`SUPABASE_BUSINESS_AUTH_DRIFT:${sourceName}`);
  }

  const { sourceFile, checker } = createBindingAwareSource(source, sourceName);
  const provenance = collectSupabaseClientProvenance(sourceFile, checker);
  if (hasSupabaseBusinessUse(sourceFile, provenance)) {
    throw new Error(`SUPABASE_BUSINESS_AUTH_DRIFT:${sourceName}`);
  }
  if (hasUnsupportedSupabaseAuthUse(sourceFile, provenance)) {
    throw new Error(`SUPABASE_AUTH_METHOD_DRIFT:${sourceName}`);
  }
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
  const namespaces = new Map();
  const receivers = new Map();
  const provenance = { checker, factories, namespaces, receivers };

  visitNodes(sourceFile, node => {
    if (ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        isAllowedServerClientModule(node.moduleSpecifier.text)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (isServerClientFactoryName((element.propertyName ?? element.name).text)) {
            addExpressionBinding(factories, element.name, checker);
          }
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        addExpressionBinding(namespaces, bindings.name, checker);
      }
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    visitNodes(sourceFile, node => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (ts.isIdentifier(node.name)) {
          changed = propagateExpressionBinding(node.name, node.initializer, provenance) || changed;
        } else if (isNamespaceExpression(node.initializer, provenance)) {
          changed = collectFactoryBindings(node.name, factories, checker) || changed;
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        changed = propagateExpressionBinding(node.left, node.right, provenance) || changed;
        if (isNamespaceExpression(node.right, provenance)) {
          changed = collectFactoryAssignments(node.left, factories, checker) || changed;
        }
      }
      if ((ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node) ||
           ts.isParameter(node) || ts.isBindingElement(node)) &&
          node.initializer && ts.isIdentifier(node.name)) {
        changed = propagateExpressionBinding(node.name, node.initializer, provenance) || changed;
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

function isSupabaseClientExpression(node, provenance) {
  const expression = unwrapExpression(node);
  return Boolean(
    hasExpressionBinding(provenance.receivers, expression, provenance.checker) ||
    (ts.isCallExpression(expression) && isFactoryReference(expression.expression, provenance)),
  );
}

function isFactoryReference(node, provenance) {
  const expression = unwrapExpression(node);
  if (hasExpressionBinding(provenance.factories, expression, provenance.checker)) return true;
  if (!isMemberAccess(expression) || !isServerClientFactoryName(accessName(expression))) return false;
  return isNamespaceExpression(expression.expression, provenance);
}

function isNamespaceExpression(node, provenance) {
  return hasExpressionBinding(provenance.namespaces, node, provenance.checker) ||
    isAllowedServerClientImportExpression(node);
}

function propagateExpressionBinding(target, value, provenance) {
  let changed = false;
  if (isFactoryReference(value, provenance)) {
    changed = addExpressionBinding(provenance.factories, target, provenance.checker) || changed;
  }
  if (isNamespaceExpression(value, provenance)) {
    changed = addExpressionBinding(provenance.namespaces, target, provenance.checker) || changed;
  }
  if (isSupabaseClientExpression(value, provenance)) {
    changed = addExpressionBinding(provenance.receivers, target, provenance.checker) || changed;
  }
  return changed;
}

function addExpressionBinding(bindings, node, checker) {
  const identity = expressionIdentity(node, checker);
  if (!identity) return false;
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

function expressionIdentity(node, checker) {
  let expression = unwrapExpression(node);
  const directSymbol = expressionSymbol(expression, checker);
  if (directSymbol) return { root: symbolBindingRoot(directSymbol), path: "[]" };
  const path = [];
  while (isMemberAccess(expression)) {
    const member = accessName(expression);
    if (!member) return null;
    path.unshift(member);
    expression = unwrapExpression(expression.expression);
  }
  if (ts.isIdentifier(expression)) {
    const symbol = checker.getSymbolAtLocation(expression);
    return symbol ? { root: symbolBindingRoot(symbol), path: JSON.stringify(path) } : null;
  }
  if (expression.kind === ts.SyntaxKind.ThisKeyword) {
    return { root: thisBindingRoot(expression), path: JSON.stringify(path) };
  }
  return null;
}

function expressionSymbol(expression, checker) {
  if (ts.isIdentifier(expression)) return checker.getSymbolAtLocation(expression);
  if (ts.isPropertyAccessExpression(expression)) return checker.getSymbolAtLocation(expression.name);
  if (ts.isElementAccessExpression(expression)) {
    const argument = unwrapExpression(expression.argumentExpression);
    if (ts.isStringLiteralLike(argument)) return checker.getSymbolAtLocation(argument);
  }
  return undefined;
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
  return ts.isStringLiteralLike(argument) ? argument.text : null;
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
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const expression = unwrapExpression(name.expression);
    return ts.isStringLiteralLike(expression) ? expression.text : null;
  }
  return null;
}

function collectFactoryBindings(name, factories, checker) {
  let changed = false;
  if (ts.isObjectBindingPattern(name)) {
    for (const element of name.elements) {
      const imported = element.propertyName ?? element.name;
      if (isServerClientFactoryName(propertyNameText(imported)) && ts.isIdentifier(element.name)) {
        changed = addExpressionBinding(factories, element.name, checker) || changed;
      }
      changed = collectFactoryBindings(element.name, factories, checker) || changed;
    }
  } else if (ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) {
        changed = collectFactoryBindings(element.name, factories, checker) || changed;
      }
    }
  }
  return changed;
}

function collectFactoryAssignments(node, factories, checker) {
  const expression = unwrapExpression(node);
  if (!ts.isObjectLiteralExpression(expression)) return false;
  let changed = false;
  for (const property of expression.properties) {
    if (!ts.isShorthandPropertyAssignment(property) && !ts.isPropertyAssignment(property)) continue;
    const imported = propertyNameText(property.name);
    if (!isServerClientFactoryName(imported)) continue;
    if (ts.isShorthandPropertyAssignment(property)) {
      changed = addExpressionBinding(factories, property.name, checker) || changed;
    } else if (ts.isPropertyAssignment(property)) {
      changed = addExpressionBinding(factories, assignmentTarget(property.initializer), checker) || changed;
    }
  }
  return changed;
}

function assignmentTarget(node) {
  const expression = unwrapExpression(node);
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return expression.left;
  }
  return expression;
}

function isAllowedServerClientImportExpression(node) {
  const expression = unwrapExpression(node);
  return ts.isCallExpression(expression) &&
    expression.expression.kind === ts.SyntaxKind.ImportKeyword &&
    expression.arguments.length === 1 &&
    ts.isStringLiteral(expression.arguments[0]) &&
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
    browserRegistry,
  ] = await Promise.all([
    read(root, "app/services/authentication-service.ts"),
    read(root, "app/services/request-authentication.ts"),
    read(root, "app/services/production-authorization.ts"),
    read(root, "app/api/auth/login/route.ts"),
    read(root, "app/api/auth/session/route.ts"),
    read(root, "app/api/initialization/access/route.ts"),
    read(root, "app/repositories/runtime/neon-domain-registry.ts"),
  ]);
  console.log(JSON.stringify(validateAuthAuthorizationSplitSources({
    authenticationService,
    requestAuthentication,
    productionAuthorization,
    loginRoute,
    sessionRoute,
    initializationAccess,
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
