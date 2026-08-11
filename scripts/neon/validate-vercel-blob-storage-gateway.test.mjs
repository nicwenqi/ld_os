import assert from "node:assert/strict";
import test from "node:test";

const gatewayModule = await import("../../app/services/import/vercel-blob-storage-gateway.ts");

const PATH = "tenant/property/imports/batch/workbook.csv";
const BYTES = new TextEncoder().encode("employee_number,name\n001,Ada\n");

test("Vercel Blob gateway rejects a missing server token", () => {
  assert.throws(
    () => gatewayModule.createVercelBlobImportStorageGateway({ token: "   " }),
    /IMPORT_STORAGE_PROVIDER_UNAVAILABLE/,
  );
});

test("Vercel Blob gateway uploads/downloads/deletes one exact private object", async () => {
  const calls = [];
  const gateway = gatewayModule.createVercelBlobImportStorageGateway({
    token: "test-token",
    blob: {
      async put(pathname, body, options) {
        calls.push({ kind: "put", pathname, bytes: new Uint8Array(body), options });
        return { pathname };
      },
      async get(pathname, options) {
        calls.push({ kind: "get", pathname, options });
        return { stream: new Blob([BYTES]).stream() };
      },
      async del(pathname, options) {
        calls.push({ kind: "del", pathname, options });
      },
    },
  });

  await gateway.upload("property-import-files", PATH, BYTES, "text/csv");
  assert.deepEqual(await gateway.download("property-import-files", PATH), BYTES);
  await gateway.remove("property-import-files", PATH);

  assert.deepEqual(calls, [
    { kind: "put", pathname: PATH, bytes: BYTES, options: { access: "private", addRandomSuffix: false, allowOverwrite: false, contentType: "text/csv", token: "test-token" } },
    { kind: "get", pathname: PATH, options: { access: "private", token: "test-token" } },
    { kind: "del", pathname: PATH, options: { token: "test-token" } },
  ]);
});

test("Vercel Blob gateway rejects a non-import logical bucket and treats only not-found deletion as idempotent", async () => {
  const gateway = gatewayModule.createVercelBlobImportStorageGateway({
    token: "test-token",
    blob: {
      async put() {},
      async get() { return null; },
      async del() { const error = new Error("Blob not found"); error.name = "BlobNotFoundError"; throw error; },
    },
  });
  await assert.rejects(gateway.upload("other", PATH, BYTES, "text/csv"), /IMPORT_STORAGE_REFERENCE_INVALID/);
  await gateway.remove("property-import-files", PATH);
});
