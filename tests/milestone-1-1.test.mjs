import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("readability stylesheet is loaded after the existing visual system", async () => {
  const globals = await read("../app/globals.css");
  assert.match(globals, /@import "\.\/readability-1-1\.css";/);
  const readability = await read("../app/readability-1-1.css");
  assert.match(readability, /MILESTONE 1\.1/);
});

test("desktop operational text uses readable sizes", async () => {
  const css = await read("../app/readability-1-1.css");
  for (const selector of [
    ".nav-item strong",
    ".signal-value strong",
    ".calendar-filters select",
    ".event strong",
    ".identity-cell strong",
    ".target-grid input",
    ".trainer-identity strong",
    ".issue-type strong",
  ]) assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(css, /font-size:12px/);
  assert.match(css, /font-size:36px/);
  assert.match(css, /\.executive-cockpit \.signal-value strong/);
  assert.match(css, /\.page-wrap \.period-control button/);
});

test("mobile QR flows preserve readable text and touch targets", async () => {
  const css = await read("../app/readability-1-1.css");
  assert.match(css, /\.mobile-card h2/);
  assert.match(css, /\.employee-card strong/);
  assert.match(css, /min-height:48px/);
  assert.match(css, /font-size:12px/);
});
