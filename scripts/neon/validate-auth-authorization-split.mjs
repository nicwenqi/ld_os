export function validateAuthAuthorizationSplitSources(input) {
  const contract = input.authenticationService;
  if (!/export\s+type\s+NeonPreAuthLoginIdentity\b/.test(contract) ||
      !/authUserId\s*:\s*string/.test(contract) ||
      !/email\s*:\s*string/.test(contract) ||
      !/export\s+type\s+NeonAuthorizationFacts\b/.test(contract) ||
      !/session\s*:\s*AuthSession/.test(contract) ||
      !/tenantId\s*:\s*string\s*\|\s*null/.test(contract) ||
      !/export\s+type\s+NeonAuthorizationRepository\b/.test(contract) ||
      !/resolveLoginIdentity\s*\(\s*hostname\s*:\s*string\s*,\s*loginId\s*:\s*string\s*\)/.test(contract) ||
      !/readSessionAuthority\s*\(\s*hostname\s*:\s*string\s*\)/.test(contract)) {
    throw new Error("NEON_AUTHORIZATION_CONTRACT_DRIFT");
  }
  if (!/export\s+function\s+createLoginResolutionDependencies\b/.test(contract) ||
      !/export\s+async\s+function\s+resolveLoginWith\b/.test(contract)) {
    throw new Error("LOGIN_RESOLUTION_FACTORY_DRIFT");
  }
  if (!/export\s+function\s+createSessionResolutionDependencies\b/.test(input.requestAuthentication) ||
      !/export\s+async\s+function\s+resolveSessionWith\b/.test(input.requestAuthentication)) {
    throw new Error("SESSION_RESOLUTION_FACTORY_DRIFT");
  }
  if (!/RuntimeDomainRegistry/.test(input.browserRegistry)) {
    throw new Error("BROWSER_REGISTRY_GATE_DRIFT");
  }
  return {
    neonAuthorizationContract: true,
    loginResolverFactory: true,
    sessionResolverFactory: true,
    browserRegistryGate: true,
  };
}

async function main() {
  if ((process.argv[2] ?? "source") !== "source") {
    throw new Error("AUTHORIZATION_SPLIT_SOURCE_VALIDATION_ONLY");
  }
  const root = new URL("../../", import.meta.url);
  const [authenticationService, requestAuthentication, browserRegistry] = await Promise.all([
    read(root, "app/services/authentication-service.ts"),
    read(root, "app/services/request-authentication.ts"),
    read(root, "app/repositories/runtime/neon-domain-registry.ts"),
  ]);
  console.log(JSON.stringify(validateAuthAuthorizationSplitSources({
    authenticationService,
    requestAuthentication,
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
