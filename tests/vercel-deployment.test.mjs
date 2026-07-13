import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Vercel builds use the Vinext Nitro adapter instead of the Cloudflare runtime adapter", async () => {
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const viteConfig = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  const globalStyles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(packageJson, /"nitro"/);
  assert.match(packageJson, /tests\/vercel-deployment\.test\.mjs/);
  assert.match(viteConfig, /isVercelBuild/);
  assert.match(viteConfig, /nitro\(\)/);
  assert.match(viteConfig, /cloudflare\(/);
  assert.match(viteConfig, /NITRO_PRESET/);
  assert.match(globalStyles, /@import "\.\.\/node_modules\/tailwindcss\/index\.css"/);
});
