import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Vercel production uses the Nitro adapter instead of Next.js output discovery", async () => {
  const [packageSource, viteSource, vercelSource] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);
  const vercelJson = JSON.parse(vercelSource);

  assert.equal(packageJson.devDependencies.nitro, "3.0.260610-beta");
  assert.match(viteSource, /import\("nitro\/vite"\)/);
  assert.match(viteSource, /import\("@tailwindcss\/postcss"\)/);
  assert.match(viteSource, /process\.env\.VERCEL === "1"/);
  assert.equal(vercelJson.framework, null);
  assert.equal(vercelJson.buildCommand, "NITRO_PRESET=vercel npx vite build");
  assert.equal(vercelJson.outputDirectory, ".output");
});
