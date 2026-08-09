import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const scriptUrl = new URL("./validate-canonical-neon-final-artifacts.mjs", import.meta.url);
const fixtureRoot = fileURLToPath(new URL("./fixtures/canonical-final-artifacts/", import.meta.url));

async function loadValidator() {
  return import(`${pathToFileURL(fileURLToPath(scriptUrl))}?task4=${Date.now()}`);
}

async function copiedFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "canonical-final-artifacts-"));
  await cp(fixtureRoot, root, { recursive: true });
  return root;
}

test("accepts a browser-safe HTTP boundary whose repository and API contracts match the manifest", async () => {
  const { validateCanonicalFinalArtifacts } = await loadValidator();
  const result = await validateCanonicalFinalArtifacts({
    root: fixtureRoot,
    manifestPath: "manifest.json",
    browserBundlePath: "dist/client",
  });

  assert.deepEqual(result, {
    domains: 1,
    repositories: 1,
    repositoryMethods: 1,
    apiRoutes: 1,
    browserSourceFiles: 2,
    browserBundleFiles: 1,
  });
});

test("fails closed when a repository interface grows beyond its manifest contract", async () => {
  const root = await copiedFixture();
  const contractPath = path.join(root, "app/repositories/contracts/example-repository.ts");
  const contract = await readFile(contractPath, "utf8");
  await writeFile(contractPath, contract.replace(
    "  listThings(): Promise<readonly string[]>;",
    "  listThings(): Promise<readonly string[]>;\n  saveThing(): Promise<void>;",
  ));
  const { validateCanonicalFinalArtifacts } = await loadValidator();

  await assert.rejects(
    validateCanonicalFinalArtifacts({ root, manifestPath: "manifest.json", browserBundlePath: "dist/client" }),
    error => error?.code === "CANONICAL_APPLICATION_CONTRACT_DRIFT"
      && error.message.includes("saveThing"),
  );
});

test("fails closed when an API route exports an undeclared HTTP method", async () => {
  const root = await copiedFixture();
  await writeFile(
    path.join(root, "app/api/example/route.ts"),
    "export async function GET() {}\nexport async function POST() {}\n",
  );
  const { validateCanonicalFinalArtifacts } = await loadValidator();

  await assert.rejects(
    validateCanonicalFinalArtifacts({ root, manifestPath: "manifest.json", browserBundlePath: "dist/client" }),
    error => error?.code === "CANONICAL_APPLICATION_CONTRACT_DRIFT"
      && error.message.includes("POST"),
  );
});

test("fails closed when a client import graph reaches the pg client", async () => {
  const root = await copiedFixture();
  await writeFile(
    path.join(root, "app/example-client.ts"),
    '"use client";\nimport { Pool } from "pg";\nexport const leaked = Pool;\n',
  );
  const { validateCanonicalFinalArtifacts } = await loadValidator();

  await assert.rejects(
    validateCanonicalFinalArtifacts({ root, manifestPath: "manifest.json", browserBundlePath: "dist/client" }),
    error => error?.code === "CANONICAL_BROWSER_SECRET_LEAK"
      && error.message.includes("pg client"),
  );
});

test("fails closed when the built client contains a database connection secret", async () => {
  const root = await copiedFixture();
  await writeFile(
    path.join(root, "dist/client/example.js"),
    'const secret = "DATABASE_URL=postgresql://runtime:password@example.test/app";\n',
  );
  const { validateCanonicalFinalArtifacts } = await loadValidator();

  await assert.rejects(
    validateCanonicalFinalArtifacts({ root, manifestPath: "manifest.json", browserBundlePath: "dist/client" }),
    error => error?.code === "CANONICAL_BROWSER_SECRET_LEAK"
      && error.message.includes("dist/client/example.js"),
  );
});
