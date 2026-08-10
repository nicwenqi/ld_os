import type { SupabaseClient } from "@supabase/supabase-js";
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
  internalEmail: string;
  accessToken?: string;
  refreshToken?: string;
};

export type NeonPreAuthLoginIdentity = Readonly<{
  authUserId: string;
  email: string;
}>;

export type NeonAuthorizationFacts = Readonly<{
  session: AuthSession;
  tenantId: string | null;
}>;

export type NeonAuthorizationRepository = Readonly<{
  resolveLoginIdentity(hostname: string, loginId: string): Promise<NeonPreAuthLoginIdentity | null>;
  readSessionAuthority(hostname: string): Promise<NeonAuthorizationFacts>;
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
  }>;
}>;

export type LoginResolutionDependencies = Readonly<{
  hostname: string;
  loginId: string;
  password: string;
  auth: PasswordSignInClient;
  neon: NeonAuthorizationRepository;
}>;

export type LoginResolution = (input: {
  loginId: string;
  password: string;
  hostname: string;
}) => Promise<ResolvedAccount>;

export function createLoginResolutionDependencies(): LoginResolution {
  return resolveAccountForLogin;
}

export async function resolveLoginWith(
  _dependencies: LoginResolutionDependencies,
): Promise<{ kind: "generic-login-failure" }> {
  throw new Error("NEON_LOGIN_AUTHORIZATION_NOT_IMPLEMENTED");
}

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
      internalEmail: "local-only@example.test",
    };
  }

  const admin = createServerAdminClient();
  const hostname = input.hostname.trim().toLowerCase().split(":")[0];
  const { data: domain } = await admin
    .from("property_domains")
    .select("tenant_id,property_id,properties(name_zh,name_en),is_active,verification_status")
    .eq("hostname", hostname)
    .eq("is_primary", true)
    .maybeSingle();
  if (!domain || !domain.is_active || domain.verification_status !== "verified") {
    throw genericLoginError();
  }
  const { data: account } = await admin
    .from("user_accounts")
    .select(
      "user_id,auth_user_id,tenant_id,property_id,account_status,must_change_password,locked_until,profiles(email,display_name,is_active)",
    )
    .eq("property_id", domain.property_id)
    .eq("normalized_login_id", input.loginId.trim().toLowerCase())
    .maybeSingle();
  const profile = relationOne(account?.profiles);
  if (
    !account ||
    !profile ||
    account.account_status !== "active" ||
    profile.is_active !== true ||
    (account.locked_until && Date.parse(account.locked_until) > Date.now())
  ) {
    throw genericLoginError();
  }
  const passwordClient = createServerPasswordClient();
  const { data: auth, error } = await passwordClient.auth.signInWithPassword({
    email: profile.email,
    password: input.password,
  });
  if (error || !auth.user || auth.user.id !== account.auth_user_id || !auth.session) {
    throw genericLoginError();
  }
  const session = await resolveSessionForAuthUser(account.auth_user_id, hostname);
  await admin
    .from("user_accounts")
    .update({ last_login_at: new Date().toISOString(), failed_login_count: 0 })
    .eq("auth_user_id", account.auth_user_id)
    .eq("property_id", account.property_id);
  return {
    session,
    internalEmail: profile.email,
    accessToken: auth.session.access_token,
    refreshToken: auth.session.refresh_token,
  };
}

export async function resolveSessionForAuthUser(
  authUserId: string,
  hostname: string,
): Promise<AuthSession> {
  const { createServerAdminClient } = await import("../lib/supabase/server-admin.ts");
  const admin = createServerAdminClient();
  const normalizedHostname = hostname.trim().toLowerCase().split(":")[0];
  const { data: domain } = await admin
    .from("property_domains")
    .select("tenant_id,property_id,properties(name_zh,name_en),is_active,verification_status")
    .eq("hostname", normalizedHostname)
    .eq("is_primary", true)
    .maybeSingle();
  if (!domain || !domain.is_active || domain.verification_status !== "verified") {
    return unauthorizedSession();
  }
  const property = relationOne(domain.properties);
  const { data: account } = await admin
    .from("user_accounts")
    .select(
      "user_id,property_id,account_status,must_change_password,locked_until,profiles(display_name,is_active)",
    )
    .eq("auth_user_id", authUserId)
    .eq("property_id", domain.property_id)
    .maybeSingle();
  const profile = relationOne(account?.profiles);
  if (
    !account ||
    !profile ||
    account.account_status !== "active" ||
    profile.is_active !== true ||
    (account.locked_until && Date.parse(account.locked_until) > Date.now())
  ) {
    return unauthorizedSession();
  }
  const [{ data: tenantMembership }, { data: propertyMembership }] = await Promise.all([
    admin
      .from("tenant_memberships")
      .select("status")
      .eq("tenant_id", domain.tenant_id)
      .eq("user_id", account.user_id)
      .maybeSingle(),
    admin
      .from("property_memberships")
      .select("status")
      .eq("property_id", domain.property_id)
      .eq("user_id", account.user_id)
      .maybeSingle(),
  ]);
  if (tenantMembership?.status !== "active" || propertyMembership?.status !== "active") {
    return unauthorizedSession(true, profile.display_name, property?.name_zh, property?.name_en);
  }

  const authority = await resolveHotelAuthority(
    admin,
    account.user_id,
    domain.tenant_id,
    domain.property_id,
  );
  return {
    authenticated: true,
    userId: account.user_id,
    displayName: profile.display_name,
    propertyId: account.property_id,
    propertyNameZh: property?.name_zh ?? null,
    propertyNameEn: property?.name_en ?? null,
    propertyLogoUrl: null,
    role: authority.role,
    departmentScopes: authority.departmentScopes,
    mustChangePassword: account.must_change_password,
  };
}

type RoleAssignmentRow = {
  id: string;
  property_id: string | null;
  roles:
    | { code: string; is_active: boolean }
    | Array<{ code: string; is_active: boolean }>
    | null;
};

type ScopeRow = {
  department_id: string;
  include_descendants: boolean;
  departments:
    | {
        id: string;
        name_zh: string;
        name_en: string | null;
        path_ids: string[];
        is_active: boolean;
      }
    | Array<{
        id: string;
        name_zh: string;
        name_en: string | null;
        path_ids: string[];
        is_active: boolean;
      }>
    | null;
};

async function resolveHotelAuthority(
  admin: SupabaseClient,
  userId: string,
  tenantId: string,
  propertyId: string,
): Promise<{ role: EffectiveRole; departmentScopes: AuthorizedDepartmentScope[] }> {
  const { data: assignments, error: assignmentsError } = await admin
    .from("role_assignments")
    .select("id,property_id,roles(code,is_active)")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("property_id", propertyId)
    .eq("status", "active");
  if (assignmentsError) return { role: "unauthorized", departmentScopes: [] };

  const activeAssignments = ((assignments ?? []) as RoleAssignmentRow[])
    .map(assignment => ({ assignment, role: relationOne(assignment.roles) }))
    .filter(entry => entry.role?.is_active === true);
  if (activeAssignments.some(entry => entry.role?.code === "property_ld_manager")) {
    return { role: "property_ld_manager", departmentScopes: [] };
  }

  const departmentAssignmentIds = activeAssignments
    .filter(entry => entry.role?.code === "department_training_admin")
    .map(entry => entry.assignment.id);
  if (!departmentAssignmentIds.length) {
    return { role: "unauthorized", departmentScopes: [] };
  }

  const { data: scopeData, error: scopeError } = await admin
    .from("trainer_scopes")
    .select(
      "department_id,include_descendants,departments!trainer_scopes_department_scope_fkey(id,name_zh,name_en,path_ids,is_active)",
    )
    .in("role_assignment_id", departmentAssignmentIds)
    .eq("property_id", propertyId)
    .eq("is_active", true);
  if (scopeError) return { role: "unauthorized", departmentScopes: [] };

  const activeScopes = ((scopeData ?? []) as ScopeRow[])
    .map(scope => ({ scope, department: relationOne(scope.departments) }))
    .filter(entry => entry.department?.is_active === true);
  if (!activeScopes.length) return { role: "unauthorized", departmentScopes: [] };

  const ancestorIds = [
    ...new Set(activeScopes.flatMap(entry => entry.department?.path_ids ?? [])),
  ];
  const { data: ancestorData, error: ancestorError } = await admin
    .from("departments")
    .select("id,name_zh,name_en")
    .eq("property_id", propertyId)
    .in("id", ancestorIds);
  if (ancestorError) return { role: "unauthorized", departmentScopes: [] };
  const ancestors = new Map(
    (ancestorData ?? []).map(department => [department.id, department]),
  );
  const departmentScopes = activeScopes.map(({ scope, department }) => {
    const path = department!.path_ids.map(id => ancestors.get(id)).filter(Boolean);
    return {
      departmentId: scope.department_id,
      departmentNameZh: department!.name_zh,
      departmentNameEn: department!.name_en,
      breadcrumb: path.map(item => item!.name_zh),
      breadcrumbEn: path.map(item => item!.name_en ?? item!.name_zh),
      includeDescendants: scope.include_descendants,
    };
  });
  return { role: "department_training_responsible", departmentScopes };
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function genericLoginError() {
  return new Error("账号或密码错误");
}

function unauthorizedSession(
  authenticated = false,
  displayName: string | null = null,
  propertyNameZh: string | null = null,
  propertyNameEn: string | null = null,
): AuthSession {
  return {
    authenticated,
    userId: null,
    displayName,
    propertyId: null,
    propertyNameZh,
    propertyNameEn,
    propertyLogoUrl: null,
    role: "unauthorized",
    departmentScopes: [],
    mustChangePassword: false,
  };
}
