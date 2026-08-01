import type { AppDataMode, AppEnvironmentName } from "../lib/environment.ts";
import type {
  AuthSession,
  AuthorizedDepartmentScope,
  EffectiveRole,
} from "../repositories/contracts/auth-repository.ts";

type SyntheticAccount = {
  loginId: string;
  password: string;
  displayName: string;
  role: EffectiveRole;
  status: "active" | "disabled";
  propertyId: string | null;
};

const syntheticAccounts: readonly SyntheticAccount[] = [
  {
    loginId: "property-manager",
    password: "HotelDemo2026",
    displayName: "学习与发展经理（本地验证）",
    role: "property_ld_manager",
    status: "active",
    propertyId: "synthetic-property-a1",
  },
  {
    loginId: "department-responsible",
    password: "HotelDemo2026",
    displayName: "部门培训负责人（本地验证）",
    role: "department_training_responsible",
    status: "active",
    propertyId: "synthetic-property-a1",
  },
  {
    loginId: "unauthorized-user",
    password: "HotelDemo2026",
    displayName: "待授权账号（本地验证）",
    role: "unauthorized",
    status: "active",
    propertyId: null,
  },
  {
    loginId: "disabled-user",
    password: "HotelDemo2026",
    displayName: "已停用账号（本地验证）",
    role: "unauthorized",
    status: "disabled",
    propertyId: "synthetic-property-a1",
  },
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
  if (input.appEnv !== "local" || input.dataMode !== "mock") {
    throw new Error("本地合成登录不可用");
  }
  const loginId = input.loginId.trim().toLowerCase();
  const account = syntheticAccounts.find(candidate => candidate.loginId === loginId);
  if (!account || account.password !== input.password || account.status !== "active") {
    throw genericLoginError();
  }
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
    departmentScopes:
      account.role === "department_training_responsible"
        ? [syntheticDepartmentScope]
        : [],
    mustChangePassword: false,
  };
}

export type ResolvedAccount = {
  session: AuthSession;
  accessToken?: string;
  refreshToken?: string;
};

export async function resolveAccountForLogin(input: {
  loginId: string;
  password: string;
  hostname: string;
}): Promise<ResolvedAccount> {
  const [{ createServerAdminClient, createServerPasswordClient }, { parseAppEnvironment }] =
    await Promise.all([
      import("../lib/supabase/server-admin.ts"),
      import("../lib/environment.ts"),
    ]);
  const environment = parseAppEnvironment();
  if (environment.appEnv === "local" && environment.dataMode === "mock") {
    return {
      session: await authenticateSyntheticAccount({
        ...input,
        appEnv: environment.appEnv,
        dataMode: environment.dataMode,
      }),
    };
  }

  const hostname = normalizeHostname(input.hostname);
  const technicalClient = createServerAdminClient();
  const { data: identityData, error: identityError } = await technicalClient.rpc(
    "resolve_hotel_login_identity",
    { p_hostname: hostname, p_login_id: input.loginId },
  );
  const internalEmail = readInternalEmail(identityData);
  if (identityError || !internalEmail) throw genericLoginError();

  const passwordClient = createServerPasswordClient();
  const { data: auth, error: passwordError } = await passwordClient.auth.signInWithPassword({
    email: internalEmail,
    password: input.password,
  });
  if (passwordError || !auth.user || !auth.session) throw genericLoginError();

  const session = await resolveSessionForAccessToken(auth.session.access_token, hostname);
  if (!session.authenticated) throw genericLoginError();
  if (isApprovedHotelRole(session.role)) {
    const { createServerActorClient } = await import("../lib/supabase/server-admin.ts");
    const actorClient = createServerActorClient(auth.session.access_token);
    const { error: transitionError } = await actorClient.rpc(
      "record_hotel_login_success",
      { p_hostname: hostname },
    );
    if (transitionError) throw genericLoginError();
  }

  return {
    session,
    accessToken: auth.session.access_token,
    refreshToken: auth.session.refresh_token,
  };
}

export async function resolveSessionForAccessToken(
  accessToken: string,
  hostname: string,
): Promise<AuthSession> {
  const { createServerActorClient } = await import("../lib/supabase/server-admin.ts");
  const actorClient = createServerActorClient(accessToken);
  const { data, error } = await actorClient.rpc(
    "resolve_hotel_application_session",
    { p_hostname: normalizeHostname(hostname) },
  );
  if (error) return unauthorizedSession();
  return readAuthSession(data) ?? unauthorizedSession();
}

function readInternalEmail(value: unknown): string | null {
  if (!isRecord(value) || typeof value.internalEmail !== "string") return null;
  const email = value.internalEmail.trim().toLowerCase();
  return email && email.length <= 320 ? email : null;
}

function readAuthSession(value: unknown): AuthSession | null {
  if (!isRecord(value) || value.authenticated !== true) return null;
  if (typeof value.userId !== "string" || typeof value.propertyId !== "string") return null;
  if (typeof value.displayName !== "string" || typeof value.mustChangePassword !== "boolean") {
    return null;
  }
  if (!isEffectiveRole(value.role)) return null;
  const scopes = readDepartmentScopes(value.departmentScopes);
  if (!scopes || (value.role === "department_training_responsible" && scopes.length === 0)) {
    return null;
  }
  return {
    authenticated: true,
    userId: value.userId,
    displayName: value.displayName,
    propertyId: value.propertyId,
    propertyNameZh: nullableString(value.propertyNameZh),
    propertyNameEn: nullableString(value.propertyNameEn),
    propertyLogoUrl: nullableString(value.propertyLogoUrl),
    role: value.role,
    departmentScopes: value.role === "property_ld_manager" ? [] : scopes,
    mustChangePassword: value.mustChangePassword,
  };
}

function readDepartmentScopes(value: unknown): AuthorizedDepartmentScope[] | null {
  if (!Array.isArray(value)) return null;
  const scopes: AuthorizedDepartmentScope[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)
      || typeof candidate.departmentId !== "string"
      || typeof candidate.departmentNameZh !== "string"
      || (candidate.departmentNameEn !== null && typeof candidate.departmentNameEn !== "string")
      || !isStringArray(candidate.breadcrumb)
      || !isStringArray(candidate.breadcrumbEn)
      || typeof candidate.includeDescendants !== "boolean") {
      return null;
    }
    scopes.push({
      departmentId: candidate.departmentId,
      departmentNameZh: candidate.departmentNameZh,
      departmentNameEn: candidate.departmentNameEn,
      breadcrumb: candidate.breadcrumb,
      breadcrumbEn: candidate.breadcrumbEn,
      includeDescendants: candidate.includeDescendants,
    });
  }
  return scopes;
}

function isApprovedHotelRole(role: EffectiveRole) {
  return role === "property_ld_manager" || role === "department_training_responsible";
}

function isEffectiveRole(value: unknown): value is EffectiveRole {
  return value === "property_ld_manager"
    || value === "department_training_responsible"
    || value === "unauthorized";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().split(":")[0];
}

function genericLoginError() {
  return new Error("账号或密码错误");
}

function unauthorizedSession(): AuthSession {
  return {
    authenticated: false,
    userId: null,
    displayName: null,
    propertyId: null,
    propertyNameZh: null,
    propertyNameEn: null,
    propertyLogoUrl: null,
    role: "unauthorized",
    departmentScopes: [],
    mustChangePassword: false,
  };
}
