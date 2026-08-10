import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtimeConsumers = [
  "app/page.tsx",
  "app/organization/page.tsx",
  "app/people/page.tsx",
  "app/positions/page.tsx",
  "app/import/page.tsx",
  "app/initialize/page.tsx",
  "app/settings/hotel/page.tsx",
  "app/accounts/page.tsx",
  "app/data-quality/page.tsx",
  "app/department/page.tsx",
  "app/department/employees/page.tsx",
  "app/components/initialization/InitializationStatusCard.tsx",
  "app/services/department-foundation.ts",
  "app/services/people-foundation.ts",
  "app/services/foundation-readiness.ts",
];

test("every browser consumer and foundation service obtains its registry through the runtime loader", async () => {
  for (const path of runtimeConsumers) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /createRepositoryRegistry\(/, path);
    assert.match(source, /RuntimeDomainRegistry|useRuntimeDomainRegistry|RuntimeDomainRegistryBoundary/, path);
  }
});
