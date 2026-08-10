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
  accessToken?: string;
  refreshToken?: string;
};

export type NeonAuthorizationRepository = Readonly<{
  resolveAuthorizationForAuthUser(authUserId: string, hostname: string, requestId: string): Promise<NeonAuthorizationFacts>;
}>;

type PasswordSignInClient = Readonly<{
  auth: Readonly<{
    signInWithPassword(input: { email: string; password: string }): Promise<{
      data: {
        user: { id: string } | null;
        session: { access_token: string; refresh_token: string } | null;
      };
      error: unknown;
    }>;
    getUser(accessToken: string): Promise<{ data: { user: { id: string } | null }; error?: unknown }>;
  }>;
}>;

export type LoginResolutionDependencies = Readonly<{
  hostname: string;
  loginId: string;
  password: string;
  auth: PasswordSignInClient;
  neon: NeonAuthorizationRepository;
  requestId?: string;
  deriveAuthEmail?: (loginId: string, hostname: string) => string;
}>;

export type LoginResolution = (input: { loginId: string; password: string; hostname: string }) => Promise<ResolvedAccount>;

export function createLoginResolutionDependencies(): LoginResolution {
  return resolveAccountForLogin;
}

export async function resolveLoginWith(
  dependencies: LoginResolutionDependencies,
): Promise<ResolvedAccount | { kind: "generic-login-failure" }> {
  try {
    const hostname = dependencies.hostname.trim().toLowerCase();
    const loginId = dependencies.loginId.trim().toLowerCase();
    const email = dependencies.deriveAuthEmail
      ? dependencies.deriveAuthEmail(loginId, hostname)
      : (await import("../lib/auth/deterministic-login-identity.ts"))
        .deriveDeterministicAuthEmail(loginId, hostname);
    const { data: auth, error } = await dependencies.auth.auth.signInWithPassword({ email, password: dependencies.password });
    if (error || !auth.user || !auth.session) return genericLoginFailure();
    const verified = await dependencies.auth.auth.getUser(auth.session.access_token);
    if (!verified.data.user || verified.data.user.id !== auth.user.id) return genericLoginFailure();
    const authorization = await dependencies.neon.resolveAuthorizationForAuthUser(
      verified.data.user.id,
      hostname,
      dependencies.requestId ?? crypto.randomUUID(),
    );
    if (!authorization.session.authenticated) return genericLoginFailure();
    return { session: authorization.session, accessToken: auth.session.access_token, refreshToken: auth.session.refresh_token };
  } catch {
    return genericLoginFailure();
  }
}

export async function resolveAccountForLogin(input: {
  loginId: string;
  password: string;
  hostname: string;
  requestId?: string;
}): Promise<ResolvedAccount> {
  const [{ createServerPasswordClient }, { parseAppEnvironment }] = await Promise.all([
    import("../lib/supabase/server-admin.ts"),
    import("../lib/environment.ts"),
  ]);
  const environment = parseAppEnvironment();
  if (environment.appEnv === "local" && environment.dataMode === "mock") {
    return { session: await authenticateSyntheticAccount({ ...input, appEnv: environment.appEnv, dataMode: environment.dataMode }) };
  }
  const resolved = await resolveLoginWith({
    ...input,
    auth: createServerPasswordClient(),
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
