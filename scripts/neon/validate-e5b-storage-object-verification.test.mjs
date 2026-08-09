import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";
import * as XLSX from "xlsx";

import { validateE5bReadbackVerificationSource } from "./validate-e5b-import-staging.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export%20{}", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const {
  WorkbookStorageVerificationError,
  verifyWorkbookStorageObject,
} = await import("../../app/services/import/storage-object-verification.ts");

const csvBytes = new TextEncoder().encode([
  "Employee No,姓名,部门,职位",
  "E-001,张三,前厅部,前厅经理",
].join("\n"));

function xlsxBytes() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["Employee No", "姓名"], ["E-001", "张三"]]),
    "Employees",
  );
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
}

function xlsBytes() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["Employee No", "姓名"], ["E-001", "张三"]]),
    "Employees",
  );
  return new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "biff8" }));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function reader(bytes) {
  let calls = 0;
  return {
    async download(bucket, objectPath) {
      calls += 1;
      assert.equal(bucket, "property-import-files");
      assert.equal(objectPath, "trusted/object/path");
      return new Uint8Array(bytes);
    },
    calls: () => calls,
  };
}

function input(bytes, overrides = {}) {
  return {
    reader: reader(bytes),
    bucket: "property-import-files",
    objectPath: "trusted/object/path",
    sanitizedFilename: "employees.csv",
    declaredChecksumSha256: sha256(bytes),
    declaredSizeBytes: bytes.byteLength,
    declaredMimeType: "text/csv",
    ...overrides,
  };
}

async function verificationFailure(promise, code) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof WorkbookStorageVerificationError);
    assert.equal(error.code, code);
    assert.equal(error.message, `WORKBOOK_STORAGE_VERIFICATION_${code}`);
    assert.doesNotMatch(error.message, /trusted\/object\/path|[0-9a-f]{64}/i);
    return true;
  });
}

test("read-back verification returns only derived evidence for a valid CSV object", async () => {
  const value = input(csvBytes);

  const result = await verifyWorkbookStorageObject(value);

  assert.deepEqual(result, {
    checksumSha256: sha256(csvBytes),
    sizeBytes: csvBytes.byteLength,
    contentDerivedMimeType: "text/csv",
  });
  assert.equal(value.reader.calls(), 1);
  assert.equal("bytes" in result, false);
  assert.equal("objectPath" in result, false);
});

test("read-back verification accepts a valid XLSX object only when its bytes and declared MIME agree", async () => {
  const bytes = xlsxBytes();
  const value = input(bytes, {
    sanitizedFilename: "employees.xlsx",
    declaredChecksumSha256: sha256(bytes),
    declaredSizeBytes: bytes.byteLength,
    declaredMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const result = await verifyWorkbookStorageObject(value);

  assert.equal(result.contentDerivedMimeType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(result.sizeBytes, bytes.byteLength);
});

test("read-back verification requires an OLE signature and a parseable workbook for XLS", async () => {
  const bytes = xlsBytes();
  const value = input(bytes, {
    sanitizedFilename: "employees.xls",
    declaredChecksumSha256: sha256(bytes),
    declaredSizeBytes: bytes.byteLength,
    declaredMimeType: "application/vnd.ms-excel",
  });

  const result = await verifyWorkbookStorageObject(value);

  assert.equal(result.contentDerivedMimeType, "application/vnd.ms-excel");
});

test("read-back verification rejects a checksum mismatch without leaking the object path or hashes", async () => {
  const value = input(csvBytes, { declaredChecksumSha256: "a".repeat(64) });

  await verificationFailure(
    verifyWorkbookStorageObject(value),
    "CHECKSUM_MISMATCH",
  );
});

test("read-back verification rejects an exact byte-size mismatch before workbook parsing", async () => {
  const value = input(csvBytes, { declaredSizeBytes: csvBytes.byteLength + 1 });

  await verificationFailure(
    verifyWorkbookStorageObject(value),
    "SIZE_MISMATCH",
  );
});

test("read-back verification rejects content MIME that differs from the declared workbook MIME", async () => {
  const bytes = xlsxBytes();
  const value = input(bytes, {
    sanitizedFilename: "employees.xlsx",
    declaredChecksumSha256: sha256(bytes),
    declaredSizeBytes: bytes.byteLength,
    declaredMimeType: "application/vnd.ms-excel",
  });

  await verificationFailure(
    verifyWorkbookStorageObject(value),
    "DECLARED_MIME_MISMATCH",
  );
});

test("read-back verification rejects invalid declared evidence before downloading", async () => {
  const value = input(csvBytes, { declaredChecksumSha256: "not-a-checksum" });

  await verificationFailure(
    verifyWorkbookStorageObject(value),
    "DECLARED_CHECKSUM_INVALID",
  );
  assert.equal(value.reader.calls(), 0);
});

test("read-back verification rejects a declared size outside the workbook limit before downloading", async () => {
  const value = input(csvBytes, { declaredSizeBytes: 25 * 1024 * 1024 + 1 });

  await verificationFailure(
    verifyWorkbookStorageObject(value),
    "DECLARED_SIZE_INVALID",
  );
  assert.equal(value.reader.calls(), 0);
});

test("read-back verification rejects content whose real workbook type conflicts with its filename", async () => {
  const bytes = xlsxBytes();
  const value = input(bytes, {
    sanitizedFilename: "employees.csv",
    declaredChecksumSha256: sha256(bytes),
    declaredSizeBytes: bytes.byteLength,
    declaredMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  await verificationFailure(
    verifyWorkbookStorageObject(value),
    "FILENAME_CONTENT_MISMATCH",
  );
});

test("read-back verification turns a Storage reader failure into a safe error", async () => {
  const value = input(csvBytes, {
    reader: {
      async download() {
        throw new Error("provider object trusted/object/path unavailable");
      },
    },
  });

  await verificationFailure(
    verifyWorkbookStorageObject(value),
    "READBACK_UNAVAILABLE",
  );
});

test("read-back verification rejects a reader result that is not downloaded bytes", async () => {
  const value = input(csvBytes, {
    reader: {
      async download() {
        return "not bytes";
      },
    },
  });

  await verificationFailure(
    verifyWorkbookStorageObject(value),
    "READBACK_BYTES_INVALID",
  );
});

test("read-back verification rejects an oversized downloaded object before parsing", async () => {
  const oversized = new Uint8Array(25 * 1024 * 1024 + 1);
  const value = input(csvBytes, {
    declaredSizeBytes: 25 * 1024 * 1024,
    reader: { async download() { return oversized; } },
  });

  await verificationFailure(
    verifyWorkbookStorageObject(value),
    "CONTENT_TOO_LARGE",
  );
});

test("read-back verification rejects malformed ZIP workbook content", async () => {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03]);
  const value = input(bytes, {
    sanitizedFilename: "employees.xlsx",
    declaredChecksumSha256: sha256(bytes),
    declaredSizeBytes: bytes.byteLength,
    declaredMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  await verificationFailure(
    verifyWorkbookStorageObject(value),
    "MALFORMED_WORKBOOK",
  );
});

test("read-back verification rejects malformed CSV content before the parser", async () => {
  const bytes = new Uint8Array([0xc3, 0x28]);
  const value = input(bytes, {
    declaredChecksumSha256: sha256(bytes),
    declaredSizeBytes: bytes.byteLength,
  });

  await verificationFailure(
    verifyWorkbookStorageObject(value),
    "CSV_UTF8_INVALID",
  );
});

test("read-back verification rejects invalid declared MIME, filename, and trusted path", async () => {
  for (const [overrides, code] of [
    [{ declaredMimeType: "application/pdf" }, "DECLARED_MIME_INVALID"],
    [{ sanitizedFilename: "../employees.csv" }, "DECLARED_FILENAME_INVALID"],
    [{ objectPath: "" }, "TRUSTED_OBJECT_REFERENCE_INVALID"],
  ]) {
    const value = input(csvBytes, overrides);
    await verificationFailure(verifyWorkbookStorageObject(value), code);
    assert.equal(value.reader.calls(), 0);
  }
});

test("read-back source validation fails closed when the service imports a database boundary", async () => {
  const source = await readFile(
    new URL("../../app/services/import/storage-object-verification.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotThrow(() => validateE5bReadbackVerificationSource(source));
  assert.throws(
    () => validateE5bReadbackVerificationSource(`${source}\nconst DATABASE_URL = \"forbidden\";`),
    /E5B_IMPORT_STAGING_READBACK_VERIFICATION_BOUNDARY_VIOLATION/,
  );
});
