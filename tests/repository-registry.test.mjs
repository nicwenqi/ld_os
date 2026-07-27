import assert from "node:assert/strict";
import test from "node:test";
import {
  createRepositoryRegistry,
  dataSourceForModule,
} from "../app/repositories/registry.ts";

test("later training facts remain unavailable in every data mode",()=>{
  for (const mode of ["mock","hybrid","supabase"]) {
    for (const moduleName of ["executive-dashboard","organization-dashboard","calendar","qr-check-in","qr-feedback","risk","course-effectiveness","kpi"]) {
      assert.equal(dataSourceForModule(moduleName,mode),"unavailable",`${mode}: ${moduleName}`);
    }
  }
});

test("D2 plan and Session foundations are real-only",()=>{
  for (const moduleName of ["plans","sessions"]) {
    assert.equal(dataSourceForModule(moduleName,"mock"),"unavailable");
    assert.equal(dataSourceForModule(moduleName,"hybrid"),"supabase");
    assert.equal(dataSourceForModule(moduleName,"supabase"),"supabase");
  }
});

test("D3 attendance facts are real-only and never fall back to local review data",()=>{
  assert.equal(dataSourceForModule("attendance","mock"),"unavailable");
  assert.equal(dataSourceForModule("attendance","hybrid"),"supabase");
  assert.equal(dataSourceForModule("attendance","supabase"),"supabase");
});

test("local foundation modules use clearly labelled mock repositories",()=>{
  for (const moduleName of ["hotel-settings","organization-management","position-management","people","import"]) assert.equal(dataSourceForModule(moduleName,"mock"),"mock");
});

test("hybrid and Supabase modes use real repositories only for validated foundations",()=>{
  for (const mode of ["hybrid","supabase"]) {
    for (const moduleName of ["hotel-settings","organization-management","position-management","people","import"]) assert.equal(dataSourceForModule(moduleName,mode),"supabase");
  }
});

test("the registry rejects an injected production environment that requests mock repositories",()=>{
  assert.throws(
    () => createRepositoryRegistry({
      environment: {
        appEnv: "production",
        dataMode: "mock",
        appBaseDomain: "ldchub.cn",
        devPropertyHostname: null,
        previewPropertyHostname: null,
        supabaseUrl: null,
        supabasePublishableKey: null,
      },
    }),
    /Production cannot use local-review repositories/,
  );
});
