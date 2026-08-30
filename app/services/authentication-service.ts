import type { AppDataMode, AppEnvironmentName } from "../lib/environment.ts";
import type {
  AuthSession,
  AuthorizedDepartmentScope,
  EffectiveRole,
} from "../repositories/contracts/auth-repository.ts";
import type { NeonAuthorizationFacts } from "../repositories/neon/authorization-session-repository.ts";

export type { NeonAuthorizationFacts } from "../repositories/neon/authorization-session-repository.ts";

type SyntheticAccount = {
  loginId: string;
  password: string;
  displayName: string;
  role: EffectiveRole;
  status: "active" | "disabled";
  propertyId: string | null;
};

const syntheticAccounts: readonly SyntheticAccount[] = [
  { loginId: "property-manager", password: "HotelDemo2026", displayName: "学习与发展经理（本地验证）", role: "property_ld_manager", status: "active", propertyId: "synthetic-property-a1" },
  { loginId: "department-responsible", password: "HotelDemo2026", displayName: "部门培训负责人（本地验证）", role: "department_training_responsible", status: "active", propertyId: "synthetic-property-a1" },
  { loginId: "unauthorized-user", password: "HotelDemo2026", displayName: "待授权账号（本地验证）", role: "unauthorized", status: "active", propertyId: null },
  { loginId: "disabled-user", password: "HotelDemo2026", displayName: "已停用账号（本地验证）", role: "unauthorized", status: "disabled", propertyId: "synthetic-property-a1" },
];

const syntheticDepartmentScope: AuthorizedDepartmentScope = {
  departmentId: "front-office",
  departmentNameZh: "前厅部",
  departmentNameEn: "Front Office",
  breadcrumb: ["房务部", "前厅部"],
  breadcrumbEn: ["Rooms", "Front Office"],
  includeDescendants: true,
};

export async function authenticateSyntheticAccount(input: {
  loginId: string;
  password: string;
  hostname: string;
  appEnv: AppEnvironmentName;
  dataMode: AppDataMode;
}): Promise<AuthSession> {
  if (input.appEnv !== "local" || input.dataMode !== "mock") throw new Error("本地合成登录不可用");
  const account = syntheticAccounts.find(candidate => candidate.loginId === input.loginId.trim().toLowerCase());
  if (!account || account.password !== input.password || account.status !== "active") throw genericLoginError();
  if (!["training-demo.example.test", "localhost", "127.0.0.1"].includes(input.hostname)) {
    throw new Error("当前账号无权访问此酒店");
  }
  return {
    authenticated: true,
    userId: `synthetic-${account.loginId}`,
    displayName: account.displayName,
    propertyId: account.propertyId,
    propertyNameZh: "示范酒店",
    propertyNameEn: "Synthetic Hotel",
    propertyLogoUrl: null,
    role: account.role,
    departmentScopes: account.role === "department_training_responsible" ? [syntheticDepartmentScope] : [],
    mustChangePassword: false,
  };
}

export type ResolvedAccount = {
  session: AuthSession;
  refreshedCookies?: string[];
};

export type NeonAuthorizationRepository = Readonly<{
  resolveAuthorizationForAuthUser(authUserId: string, hostname: string, requestId: string): Promise<NeonAuthorizationFacts>;
}>;

export type LoginResolutionDependencies = Readonly<{
  request: Request;
  hostname: string;
  loginId: string;
  password: string;
  neon: NeonAuthorizationRepository;
  requestId?: string;
  signIn: (input: { request: Request; loginId: string; password: string; hostname: string }) => Promise<{ userId: string; refreshedCookies: string[] } | null>;
}>;

export type LoginResolution = (input: { request: Request; loginId: string; password: string; hostname: string; requestId?: string }) => Promise<ResolvedAccount>;

export function createLoginResolutionDependencies(): LoginResolution {
  return resolveAccountForLogin;
}

export async function resolveLoginWith(
  dependencies: LoginResolutionDependencies,
): Promise<ResolvedAccount | { kind: "generic-login-failure" }> {
  try {
    const hostname = dependencies.hostname.trim().toLowerCase();
    const authenticated = await dependencies.signIn({
      request: dependencies.request,
      loginId: dependencies.loginId,
      password: dependencies.password,
      hostname,
    });
    if (!authenticated) return genericLoginFailure();
    const authorization = await dependencies.neon.resolveAuthorizationForAuthUser(
      authenticated.userId,
      hostname,
      dependencies.requestId ?? crypto.randomUUID(),
    );
    if (!authorization.session.authenticated) return genericLoginFailure();
    return { session: authorization.session, refreshedCookies: authenticated.refreshedCookies };
  } catch {
    return genericLoginFailure();
  }
}

export async function resolveAccountForLogin(input: {
  request: Request;
  loginId: string;
  password: string;
  hostname: string;
  requestId?: string;
}): Promise<ResolvedAccount> {
  const [{ signInWithBetterAuth }, { parseAppEnvironment }] = await Promise.all([
    import("./better-auth-session.ts"),
    import("../lib/environment.ts"),
  ]);
  const environment = parseAppEnvironment();
  if (environment.appEnv === "local" && environment.dataMode === "mock") {
    return { session: await authenticateSyntheticAccount({ ...input, appEnv: environment.appEnv, dataMode: environment.dataMode }) };
  }
  const resolved = await resolveLoginWith({
    ...input,
    signIn: signInWithBetterAuth,
    neon: { resolveAuthorizationForAuthUser: resolveNeonAuthorizationForAuthUser },
  });
  if ("kind" in resolved) throw genericLoginError();
  return resolved;
}

export async function resolveSessionForAuthUser(
  authUserId: string,
  hostname: string,
  requestId = crypto.randomUUID(),
): Promise<AuthSession> {
  const authorization = await resolveNeonAuthorizationForAuthUser(
    authUserId,
    hostname.trim().toLowerCase(),
    requestId,
  );
  return authorization.session;
}

export async function resolveNeonAuthorizationForAuthUser(
  authUserId: string,
  hostname: string,
  requestId: string,
): Promise<NeonAuthorizationFacts> {
  const repository = await import("../repositories/neon/authorization-session-repository.ts");
  return repository.resolveNeonAuthorizationForAuthUser(authUserId, hostname, requestId);
}

function genericLoginFailure() {
  return { kind: "generic-login-failure" } as const;
}

function genericLoginError() {
  return new Error("账号或密码错误");
}
