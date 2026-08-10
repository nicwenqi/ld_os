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
      /(?:lib\/supabase\/(?:browser|client)|createBrowserClient|createClientComponentClient)/.test(source) ||
      /\.\s*(?:from|rpc)\s*\(/.test(source) ||
      /(?:\.\s*(?:from|rpc)\b|\[\s*["'](?:from|rpc)["']\s*\])/.test(source) ||
      hasDestructuredBusinessMethod(source) ||
      hasBareBusinessMethodCall(source)) {
    throw new Error(`SUPABASE_BUSINESS_AUTH_DRIFT:${sourceName}`);
  }

  for (const match of source.matchAll(/(\?\.|\.)\s*auth\s*(\?\.|\.)\s*([A-Za-z_$][\w$]*)\s*(\?\.)?\s*\(/g)) {
    const [, authAccess, methodAccess, method, invocationAccess] = match;
    if (authAccess !== "." || methodAccess !== "." || invocationAccess || !["signInWithPassword", "getUser", "refreshSession"].includes(method)) {
      throw new Error(`SUPABASE_AUTH_METHOD_DRIFT:${sourceName}`);
    }
  }
  if (/(?:\.|\?\.)\s*auth\s*\[|(?:const|let|var)\s+\{[^{}]*\}\s*=\s*[^;\n]*(?:\.|\?\.)\s*auth\s*(?=;|$)/m.test(source)) {
    throw new Error(`SUPABASE_AUTH_METHOD_DRIFT:${sourceName}`);
  }
}

function hasDestructuredBusinessMethod(source) {
  for (const match of source.matchAll(/\{([^}]*)\}\s*=/g)) {
    if (match[1].split(",").some(field => /^\s*(?:from|rpc)\b/.test(field))) return true;
  }
  return false;
}

function hasBareBusinessMethodCall(source) {
  return /(?<![.\w$])(?:from|rpc)\s*\(/.test(source);
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
