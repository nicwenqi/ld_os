export type EffectiveRole =
  | "platform_admin"
  | "tenant_admin"
  | "property_ld_manager"
  | "department_training_admin"
  | "employee"
  | "unauthorized";

export type AuthSession = {
  authenticated: boolean;
  userId: string | null;
  displayName: string | null;
  propertyId: string | null;
  propertyNameZh: string | null;
  propertyNameEn: string | null;
  propertyLogoUrl: string | null;
  role: EffectiveRole;
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
  mustChangePassword: false,
};
