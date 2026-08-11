import { BlobNotFoundError, del, get, put } from "@vercel/blob";

import type { ImportStorageGateway } from "../neon-import-staging-authorization.ts";

const IMPORT_BUCKET = "property-import-files" as const;

type BlobOperations = Readonly<{
  put(pathname: string, body: Uint8Array, options: { access: "private"; addRandomSuffix: false; allowOverwrite: false; contentType: string; token: string }): Promise<unknown>;
  get(pathname: string, options: { access: "private"; token: string }): Promise<{ stream: ReadableStream<Uint8Array> } | null>;
  del(pathname: string, options: { token: string }): Promise<void>;
}>;

export type VercelBlobGatewayOptions = Readonly<{
  token?: string;
  blob?: BlobOperations;
}>;

export function createVercelBlobImportStorageGateway(
  options: VercelBlobGatewayOptions = {},
): ImportStorageGateway {
  const token = requireBlobToken(options.token);
  const blob: BlobOperations = options.blob ?? { put, get, del };
  return {
    async upload(bucket, objectPath, body, contentType) {
      assertImportObjectReference(bucket, objectPath);
      await blob.put(objectPath, body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType,
        token,
      });
    },
    async download(bucket, objectPath) {
      assertImportObjectReference(bucket, objectPath);
      const result = await blob.get(objectPath, { access: "private", token });
      if (!result?.stream) throw new Error("IMPORT_STORAGE_READBACK_FAILED");
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },
    async remove(bucket, objectPath) {
      assertImportObjectReference(bucket, objectPath);
      try {
        await blob.del(objectPath, { token });
      } catch (error) {
        if (!isNotFound(error)) throw new Error("IMPORT_STORAGE_REMOVE_FAILED");
      }
    },
  };
}

function requireBlobToken(value: string | undefined) {
  const token = (value ?? process.env.BLOB_READ_WRITE_TOKEN ?? "").trim();
  if (!token) throw new Error("IMPORT_STORAGE_PROVIDER_UNAVAILABLE");
  return token;
}

function assertImportObjectReference(bucket: string, objectPath: string) {
  if (bucket !== IMPORT_BUCKET || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,999}$/.test(objectPath) || objectPath.includes("..") || objectPath.includes("//")) {
    throw new Error("IMPORT_STORAGE_REFERENCE_INVALID");
  }
}

function isNotFound(error: unknown) {
  return error instanceof BlobNotFoundError || (error instanceof Error && error.name === "BlobNotFoundError");
}
