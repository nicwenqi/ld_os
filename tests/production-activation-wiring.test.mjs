import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as XLSX from "xlsx";

import { resolveRequestHostname } from "../app/lib/request-hostname.ts";
import { prepareEmployeeMasterStaging } from "../app/services/import/production-workbook-staging.ts";

test("production hostname trusts the Vercel forwarded host and normalizes it", () => {
  const request = new Request("https://internal-vercel-host.example/login", {
    headers: {
      host: "internal-vercel-host.example",
      "x-forwarded-host": "KTSZ.LDCHUB.CN:443, proxy.internal",
    },
  });

  assert.equal(resolveRequestHostname(request, {
    appEnv: "production",
    appBaseDomain: "ldchub.cn",
    localOverride: "training-demo.example.test",
  }), "ktsz.ldchub.cn");
});

test("production hostname rejects localhost and hosts outside the configured base domain", () => {
  for (const hostname of ["localhost:3000", "hotel.example.com", "ldchub.cn.evil.example"]) {
    const request = new Request("https://deployment.vercel.app/", {
      headers: { "x-forwarded-host": hostname },
    });
    assert.equal(resolveRequestHostname(request, {
      appEnv: "production",
      appBaseDomain: "ldchub.cn",
      localOverride: "ktsz.ldchub.cn",
    }), null);
  }
});

test("local property override is available only outside production", () => {
  const request = new Request("http://localhost:3000/");
  assert.equal(resolveRequestHostname(request, {
    appEnv: "local",
    appBaseDomain: "ldchub.cn",
    localOverride: "training-demo.example.test",
  }), "training-demo.example.test");
});

test("trusted staging preserves private evidence and returns aggregate-only inspection", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Synthetic employee master"],
    [],
    ["Empid", "CName", "EName", "Department", "Position", "JoinDate", "CTC Completion", "Gender"],
    ["0007", "示例员工甲", "Synthetic Associate", "Front Office", "Guest Service Associate", new Date("2026-06-01"), 1, "X"],
  ]);
  sheet.H4 = { t: "n", v: 1, f: "1" };
  const bytes = XLSX.write({ SheetNames: ["Employee Master"], Sheets: { "Employee Master": sheet } }, { type: "buffer", bookType: "xlsx" });

  const result = prepareEmployeeMasterStaging({
    fileName: "synthetic-employee-master.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: new Uint8Array(bytes),
  });

  assert.equal(result.safeSummary.sourceRows, 1);
  assert.equal(result.safeSummary.selectedSheet, "Employee Master");
  assert.equal(result.sourceRows[0].normalizedValues.employee_number, "0007");
  assert.equal(result.sourceRows[0].rawValues["CTC Completion"], 1);
  assert.equal("ctc_completion" in result.sourceRows[0].normalizedValues, false);
  assert.equal("gender" in result.sourceRows[0].normalizedValues, false);
  assert.equal(result.fieldMappings.some(mapping => mapping.sourceColumnName === "CTC Completion"), false);
  assert.equal(result.fieldMappings.some(mapping => mapping.sourceColumnName === "Gender"), false);
  assert.doesNotMatch(JSON.stringify(result.safeSummary), /示例员工甲|0007|Synthetic Associate/);
});

test("production routes use server-authorized property context and never accept a property id", async () => {
  const [contextRoute, inspectionRoute, tokenRoute, browserClient, loginPage, initializePage, importPage] = await Promise.all([
    readFile(new URL("../app/api/property/context/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/import/inspect/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/access-token/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/supabase/browser.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/initialize/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/import/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(contextRoute, /resolveRequestHostname/);
  assert.match(inspectionRoute, /requireProductionPropertyManager/);
  assert.match(inspectionRoute, /property-import-files/);
  assert.doesNotMatch(inspectionRoute, /form\.get\(["']propertyId["']\)/);
  assert.match(tokenRoute, /resolveAuthenticatedRequest/);
  assert.match(tokenRoute, /["']Cache-Control["']\s*:\s*["']no-store["']/);
  assert.doesNotMatch(tokenRoute, /SUPABASE_SECRET_KEY|secretKey/);
  assert.match(browserClient, /accessToken/);
  assert.match(browserClient, /\/api\/auth\/access-token/);
  assert.doesNotMatch(browserClient, /SUPABASE_SECRET_KEY|service.role/i);
  assert.match(loginPage, /\/api\/property\/context/);
  assert.match(initializePage, /session\.propertyId/);
  assert.match(importPage, /fetch\("\/api\/import\/inspect"/);
  assert.match(importPage, /type="file"/);
});

test("production auth keeps refresh credentials HttpOnly, renews an expired access cookie, and clears both cookies", async () => {
  const [cookies, loginRoute, sessionRoute, logoutRoute] = await Promise.all([
    readFile(new URL("../app/api/auth/cookies.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/logout/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(cookies, /hotel_ld_refresh/);
  assert.match(cookies, /HttpOnly/);
  assert.match(loginRoute, /refreshToken/);
  assert.match(sessionRoute, /readRefreshCookie/);
  assert.match(logoutRoute, /expiredAuthCookies/);
});

test("public hostname resolver suppresses inactive and unknown private context", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20260712190143_property_context_and_settings.sql", import.meta.url), "utf8");
  assert.match(migration, /domain\.is_active/);
  assert.match(migration, /domain\.verification_status = 'verified'/);
  assert.match(migration, /property\.status = 'active'/);
  assert.match(migration, /tenant\.status = 'active'/);
});

test("Vite exposes only the validated public runtime boundary to browser repositories", async () => {
  const [viteConfig, environment, statusCard] = await Promise.all([
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/environment.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/initialization/InitializationStatusCard.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(viteConfig, /browserEnvironmentDefines/);
  assert.match(viteConfig, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(viteConfig, /SUPABASE_SECRET_KEY|SERVICE_ROLE/);
  assert.match(environment, /defaultEnvironmentInput/);
  assert.match(statusCard, /session\.propertyId/);
  assert.doesNotMatch(statusCard, /resolveContext\(hostname\)/);
});
