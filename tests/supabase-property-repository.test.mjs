import assert from "node:assert/strict";
import test from "node:test";

import {
  absolutePublicLogoUrl,
  buildBrandAssetPath,
  createSupabasePropertyRepository,
  displayPropertyCode,
} from "../app/repositories/supabase/property-repository.ts";

test("normalized property codes are presented in the confirmed hotel business format", () => {
  assert.equal(displayPropertyCode("szvbg"), "SZVBG");
});

test("public logo paths are versioned, property-owned, and non-guessable", () => {
  const path = buildBrandAssetPath({
    tenantId: "10000000-0000-0000-0000-000000000001",
    propertyId: "20000000-0000-0000-0000-000000000011",
    assetId: "60000000-0000-0000-0000-000000000011",
    version: 3,
    mimeType: "image/webp",
  });
  assert.equal(path, "10000000-0000-0000-0000-000000000001/20000000-0000-0000-0000-000000000011/branding/60000000-0000-0000-0000-000000000011/logo-v3.webp");
});

test("resolver maps safe public context and public logo URL", async () => {
  const fakeClient = {
    async rpc(name, params) {
      assert.equal(name, "resolve_property_context");
      assert.deepEqual(params, { p_hostname: "demo-a1.example.test" });
      return { data: [{
        tenant_id: "tenant-1", property_id: "property-1", hostname: "demo-a1.example.test",
        name_zh: "示范酒店", name_en: "Synthetic Hotel", short_name: "示范酒店",
        logo_url: "/storage/v1/object/public/property-brand-assets/path/logo-v1.webp",
      }], error: null };
    },
  };
  const repository = createSupabasePropertyRepository(fakeClient, "https://demo.supabase.co");
  const context = await repository.resolveContext("demo-a1.example.test");
  assert.equal(context?.propertyId, "property-1");
  assert.equal(context?.logoUrl, "https://demo.supabase.co/storage/v1/object/public/property-brand-assets/path/logo-v1.webp");
});

test("relative public logo paths are combined with the configured Supabase origin", () => {
  assert.equal(absolutePublicLogoUrl("https://demo.supabase.co/", null), null);
  assert.equal(
    absolutePublicLogoUrl("https://demo.supabase.co/", "/storage/v1/object/public/property-brand-assets/a.webp"),
    "https://demo.supabase.co/storage/v1/object/public/property-brand-assets/a.webp",
  );
});
