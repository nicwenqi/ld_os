import type {
  PropertyRepository,
  SaveBusinessRulesInput,
  SavePropertyIdentityInput,
  UploadPropertyLogoInput,
} from "../contracts/property-repository.ts";
import type { HotelPropertyRecord, PropertyContext } from "../contracts/models.ts";

export function createHttpPropertyRepository(): PropertyRepository {
  return {
    async resolveContext(hostname): Promise<PropertyContext | null> {
      void hostname;
      const payload = await request<{ configured: boolean } & Partial<PropertyContext>>("/api/property/context");
      if (!payload.configured || !payload.propertyId || !payload.tenantId || !payload.hostname) return null;
      return payload as PropertyContext;
    },
    getProperty() {
      return request<HotelPropertyRecord>("/api/property");
    },
    saveIdentity(input: SavePropertyIdentityInput) {
      const { propertyId: _propertyId, ...body } = input;
      return request<HotelPropertyRecord>("/api/property/identity", json("PATCH", body));
    },
    saveBusinessRules(input: SaveBusinessRulesInput) {
      const { propertyId: _propertyId, ...body } = input;
      return request<HotelPropertyRecord>("/api/property/settings", json("PATCH", body));
    },
    uploadLogo(_input: UploadPropertyLogoInput) {
      return Promise.reject(new Error("Neon Property brand assets remain on the Supabase Storage boundary"));
    },
    cleanupExpiredLogos() {
      return Promise.reject(new Error("Neon Property brand assets remain on the Supabase Storage boundary"));
    },
  };
}

function json(method: "PATCH", body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store" });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "酒店基础服务暂时不可用");
  return payload;
}
