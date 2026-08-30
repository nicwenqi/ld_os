import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { MAX_IMPORT_BYTES, inspectWorkbook, sanitizeWorkbookFilename } from "./workbook-parser.ts";

const SHA256_HEX = /^[0-9a-f]{64}$/;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;
const MAX_OBJECT_PATH_LENGTH = 1024;

const CONTENT_TYPES = Object.freeze({
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
});

type WorkbookExtension = keyof typeof CONTENT_TYPES;

export type StorageObjectReader = {
  /** Must download the persisted object after upload; metadata is insufficient. */
  download(bucket: string, objectPath: string): Promise<Uint8Array>;
};

/** Server-internal evidence for the saga coordinator; never a browser projection. */
export type VerifiedWorkbookObject = {
  checksumSha256: string;
  sizeBytes: number;
  contentDerivedMimeType: string;
};

export type WorkbookStorageVerificationFailureCode =
  | "DECLARED_CHECKSUM_INVALID"
  | "DECLARED_SIZE_INVALID"
  | "DECLARED_MIME_INVALID"
  | "DECLARED_FILENAME_INVALID"
  | "TRUSTED_OBJECT_REFERENCE_INVALID"
  | "READBACK_UNAVAILABLE"
  | "READBACK_BYTES_INVALID"
  | "CONTENT_TOO_LARGE"
  | "SIZE_MISMATCH"
  | "CHECKSUM_MISMATCH"
  | "CSV_UTF8_INVALID"
  | "CSV_BINARY_CONTENT"
  | "MALFORMED_WORKBOOK"
  | "FILENAME_CONTENT_MISMATCH"
  | "DECLARED_MIME_MISMATCH";

/**
 * Deliberately contains a stable code only: callers must not expose provider
 * errors, object paths, byte contents, or full hashes to browser responses.
 */
export class WorkbookStorageVerificationError extends Error {
  readonly code: WorkbookStorageVerificationFailureCode;

  constructor(code: WorkbookStorageVerificationFailureCode) {
    super(`WORKBOOK_STORAGE_VERIFICATION_${code}`);
    this.name = "WorkbookStorageVerificationError";
    this.code = code;
  }
}

/**
 * This is intentionally a Storage-only operation. It performs no Neon query
 * and must be called outside an Actor Context/database transaction. Task 7
 * persists this returned server-only evidence through the 091 entrypoint.
 */
export async function verifyWorkbookStorageObject(input: {
  reader: StorageObjectReader;
  bucket: "property-import-files";
  objectPath: string;
  sanitizedFilename: string;
  declaredChecksumSha256: string;
  declaredSizeBytes: number;
  declaredMimeType: string;
}): Promise<VerifiedWorkbookObject> {
  const declared = validateDeclaredEvidence(input);
  const bytes = await downloadReadBackBytes(input.reader, input.bucket, input.objectPath);

  if (bytes.byteLength > MAX_IMPORT_BYTES) fail("CONTENT_TOO_LARGE");
  if (bytes.byteLength !== declared.sizeBytes) fail("SIZE_MISMATCH");

  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  if (!SHA256_HEX.test(checksumSha256) || !sha256Equals(declared.checksumSha256, checksumSha256)) {
    fail("CHECKSUM_MISMATCH");
  }

  const content = deriveWorkbookContent(bytes);
  if (declared.extension !== content.extension) fail("FILENAME_CONTENT_MISMATCH");
  if (declared.mimeType !== content.mimeType) fail("DECLARED_MIME_MISMATCH");

  return {
    checksumSha256,
    sizeBytes: bytes.byteLength,
    contentDerivedMimeType: content.mimeType,
  };
}

function validateDeclaredEvidence(input: {
  bucket: "property-import-files";
  objectPath: string;
  sanitizedFilename: string;
  declaredChecksumSha256: string;
  declaredSizeBytes: number;
  declaredMimeType: string;
}) {
  if (input.bucket !== "property-import-files"
    || typeof input.objectPath !== "string"
    || !input.objectPath.length
    || input.objectPath.length > MAX_OBJECT_PATH_LENGTH) {
    fail("TRUSTED_OBJECT_REFERENCE_INVALID");
  }
  if (typeof input.declaredChecksumSha256 !== "string" || !SHA256_HEX.test(input.declaredChecksumSha256)) {
    fail("DECLARED_CHECKSUM_INVALID");
  }
  if (!Number.isSafeInteger(input.declaredSizeBytes)
    || input.declaredSizeBytes < 1
    || input.declaredSizeBytes > MAX_IMPORT_BYTES) {
    fail("DECLARED_SIZE_INVALID");
  }
  if (typeof input.sanitizedFilename !== "string"
    || input.sanitizedFilename !== sanitizeWorkbookFilename(input.sanitizedFilename)
    || !SAFE_FILENAME.test(input.sanitizedFilename)
    || input.sanitizedFilename.includes("..")) {
    fail("DECLARED_FILENAME_INVALID");
  }

  const extension = workbookExtension(input.sanitizedFilename);
  if (!extension) fail("DECLARED_FILENAME_INVALID");
  if (!isWorkbookMimeType(input.declaredMimeType)) fail("DECLARED_MIME_INVALID");

  return {
    checksumSha256: input.declaredChecksumSha256,
    sizeBytes: input.declaredSizeBytes,
    mimeType: input.declaredMimeType,
    extension,
  } as const;
}

function isWorkbookMimeType(value: string): value is (typeof CONTENT_TYPES)[WorkbookExtension] {
  return Object.values(CONTENT_TYPES).some(contentType => contentType === value);
}

async function downloadReadBackBytes(
  reader: StorageObjectReader,
  bucket: "property-import-files",
  objectPath: string,
): Promise<Uint8Array> {
  let value: unknown;
  try {
    value = await reader.download(bucket, objectPath);
  } catch {
    fail("READBACK_UNAVAILABLE");
  }
  if (!(value instanceof Uint8Array)) fail("READBACK_BYTES_INVALID");
  if (!value.byteLength) fail("READBACK_BYTES_INVALID");
  return new Uint8Array(value);
}

function deriveWorkbookContent(bytes: Uint8Array): {
  extension: WorkbookExtension;
  mimeType: string;
} {
  if (hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    assertParsesAsWorkbook(bytes, "xls");
    return { extension: "xls", mimeType: CONTENT_TYPES.xls };
  }
  if (hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    assertParsesAsWorkbook(bytes, "xlsx");
    return { extension: "xlsx", mimeType: CONTENT_TYPES.xlsx };
  }

  assertValidCsv(bytes);
  assertParsesAsWorkbook(bytes, "csv");
  return { extension: "csv", mimeType: CONTENT_TYPES.csv };
}

function assertParsesAsWorkbook(bytes: Uint8Array, extension: WorkbookExtension) {
  try {
    const inspection = inspectWorkbook({
      fileName: `verified.${extension}`,
      mimeType: CONTENT_TYPES[extension],
      bytes,
    });
    if (!inspection.sheets.length) fail("MALFORMED_WORKBOOK");
  } catch (error) {
    if (error instanceof WorkbookStorageVerificationError) throw error;
    fail("MALFORMED_WORKBOOK");
  }
}

function assertValidCsv(bytes: Uint8Array) {
  if (bytes.includes(0)) fail("CSV_BINARY_CONTENT");
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("CSV_UTF8_INVALID");
  }
}

function workbookExtension(filename: string): WorkbookExtension | null {
  const extension = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  return extension === "xls" || extension === "xlsx" || extension === "csv" ? extension : null;
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]) {
  return bytes.byteLength >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

function sha256Equals(declaredChecksumSha256: string, actualChecksumSha256: string) {
  if (!SHA256_HEX.test(declaredChecksumSha256) || !SHA256_HEX.test(actualChecksumSha256)) return false;
  return timingSafeEqual(
    Buffer.from(declaredChecksumSha256, "hex"),
    Buffer.from(actualChecksumSha256, "hex"),
  );
}

function fail(code: WorkbookStorageVerificationFailureCode): never {
  throw new WorkbookStorageVerificationError(code);
}
