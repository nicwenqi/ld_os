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

  const sourceFile = ts.createSourceFile(
    `${sourceName}.ts`,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const provenance = collectSupabaseClientProvenance(sourceFile);
  if (hasSupabaseBusinessUse(sourceFile, provenance)) {
    throw new Error(`SUPABASE_BUSINESS_AUTH_DRIFT:${sourceName}`);
  }
  if (hasUnsupportedSupabaseAuthUse(sourceFile, provenance)) {
    throw new Error(`SUPABASE_AUTH_METHOD_DRIFT:${sourceName}`);
  }
}

function collectSupabaseClientProvenance(sourceFile) {
  const factories = new Set();
  const namespaces = new Set();
  const receivers = new Set();

  visitNodes(sourceFile, node => {
    if (ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        isAllowedServerClientModule(node.moduleSpecifier.text)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (isServerClientFactoryName((element.propertyName ?? element.name).text)) {
            factories.add(element.name.text);
          }
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        namespaces.add(bindings.name.text);
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer && containsAllowedServerClientImport(node.initializer)) {
      collectFactoryBindings(node.name, factories);
      if (ts.isIdentifier(node.name) && isDirectImportExpression(node.initializer)) {
        namespaces.add(node.name.text);
      }
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    visitNodes(sourceFile, node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (isFactoryReference(node.initializer, factories, namespaces)) {
          changed = add(factories, node.name.text) || changed;
        }
        if (isSupabaseClientExpression(node.initializer, factories, namespaces, receivers)) {
          changed = add(receivers, node.name.text) || changed;
        }
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const target = expressionKey(node.left);
        if (target && isSupabaseClientExpression(node.right, factories, namespaces, receivers)) {
          changed = add(receivers, target) || changed;
        }
      }
    });
  }

  return { factories, namespaces, receivers };
}

function hasSupabaseBusinessUse(sourceFile, provenance) {
  let found = false;
  visitNodes(sourceFile, node => {
    if (found) return;
    if (isMemberAccess(node) &&
        ["from", "rpc"].includes(accessName(node)) &&
        isSupabaseClientExpression(node.expression, provenance.factories, provenance.namespaces, provenance.receivers)) {
      found = true;
      return;
    }
    if (ts.isVariableDeclaration(node) &&
        node.initializer &&
        isSupabaseClientExpression(node.initializer, provenance.factories, provenance.namespaces, provenance.receivers) &&
        bindingSelects(node.name, ["from", "rpc"])) {
      found = true;
      return;
    }
    if (ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        isSupabaseClientExpression(node.right, provenance.factories, provenance.namespaces, provenance.receivers) &&
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
        isSupabaseClientExpression(node.initializer, provenance.factories, provenance.namespaces, provenance.receivers) &&
        bindingSelects(node.name, ["auth"])) {
      found = true;
      return;
    }
    if (!isMemberAccess(node) ||
        accessName(node) !== "auth" ||
        !isSupabaseClientExpression(node.expression, provenance.factories, provenance.namespaces, provenance.receivers)) {
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

function isSupabaseClientExpression(node, factories, namespaces, receivers) {
  const expression = unwrapExpression(node);
  const key = expressionKey(expression);
  return Boolean(
    (key && receivers.has(key)) ||
    (ts.isCallExpression(expression) && isFactoryReference(expression.expression, factories, namespaces)),
  );
}

function isFactoryReference(node, factories, namespaces) {
  const expression = unwrapExpression(node);
  if (ts.isIdentifier(expression)) return factories.has(expression.text);
  if (!isMemberAccess(expression) || !isServerClientFactoryName(accessName(expression))) return false;
  const namespace = expressionKey(expression.expression);
  return Boolean(namespace && namespaces.has(namespace));
}

function expressionKey(node) {
  const expression = unwrapExpression(node);
  if (ts.isIdentifier(expression)) return expression.text;
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return "this";
  if (!isMemberAccess(expression)) return null;
  const receiver = expressionKey(expression.expression);
  const member = accessName(expression);
  return receiver && member ? `${receiver}.${member}` : null;
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
    return ts.isIdentifier(selected) && members.includes(selected.text);
  });
}

function assignmentSelects(node, members) {
  const expression = unwrapExpression(node);
  if (!ts.isObjectLiteralExpression(expression)) return false;
  return expression.properties.some(property => {
    if (!ts.isShorthandPropertyAssignment(property) && !ts.isPropertyAssignment(property)) return false;
    const selected = property.name;
    return ts.isIdentifier(selected) && members.includes(selected.text);
  });
}

function collectFactoryBindings(name, factories) {
  if (ts.isObjectBindingPattern(name)) {
    for (const element of name.elements) {
      const imported = element.propertyName ?? element.name;
      if (ts.isIdentifier(imported) && isServerClientFactoryName(imported.text) && ts.isIdentifier(element.name)) {
        factories.add(element.name.text);
      }
      collectFactoryBindings(element.name, factories);
    }
  } else if (ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) collectFactoryBindings(element.name, factories);
    }
  }
}

function containsAllowedServerClientImport(node) {
  let found = false;
  visitNodes(node, candidate => {
    if (ts.isCallExpression(candidate) &&
        candidate.expression.kind === ts.SyntaxKind.ImportKeyword &&
        candidate.arguments.length === 1 &&
        ts.isStringLiteral(candidate.arguments[0]) &&
        isAllowedServerClientModule(candidate.arguments[0].text)) {
      found = true;
    }
  });
  return found;
}

function isDirectImportExpression(node) {
  const expression = unwrapExpression(node);
  return ts.isCallExpression(expression) && expression.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function isAllowedServerClientModule(value) {
  return /(?:^|\/)lib\/supabase\/server-admin(?:\.ts)?$/.test(value);
}

function isServerClientFactoryName(value) {
  return /^createServer(?:Admin|Password|Actor)Client$/.test(value);
}

function add(set, value) {
  const size = set.size;
  set.add(value);
  return set.size !== size;
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
