export type EffectiveRole =
  | "property_ld_manager"
  | "department_training_responsible"
  | "unauthorized";

export type AuthorizedDepartmentScope = {
  departmentId: string;
  departmentNameZh: string;
  departmentNameEn: string | null;
  breadcrumb: string[];
  breadcrumbEn: string[];
  includeDescendants: boolean;
};

export type AuthSession = {
  authenticated: boolean;
  userId: string | null;
  displayName: string | null;
  propertyId: string | null;
  propertyNameZh: string | null;
  propertyNameEn: string | null;
  propertyLogoUrl: string | null;
  role: EffectiveRole;
  departmentScopes: AuthorizedDepartmentScope[];
  mustChangePassword: boolean;
};

export type LoginInput = { loginId: string; password: string; hostname: string };

export interface AuthRepository {
  login(input: LoginInput): Promise<AuthSession>;
  getSession(): Promise<AuthSession>;
  logout(): Promise<void>;
}

export const anonymousSession: AuthSession = {
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
