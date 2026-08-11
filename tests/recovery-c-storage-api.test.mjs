import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("active Import storage is server-only Vercel Blob with no provider bearer dependency", async () => {
  const [adapter, gateway, boundary] = await Promise.all([
    readFile(new URL("../app/services/import/vercel-blob-import-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/services/import/vercel-blob-storage-gateway.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/services/import/storage-saga-coordinator.ts", import.meta.url), "utf8"),
  ]);
  assert.match(gateway, /@vercel\/blob/);
  assert.match(gateway, /BLOB_READ_WRITE_TOKEN/);
  assert.doesNotMatch(`${adapter}\n${gateway}\n${boundary}`, /supabase|accessToken/i);
});
