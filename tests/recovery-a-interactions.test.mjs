import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("the shared shell has only truthful global actions", async () => {
  const shell = await read("../app/components/shell/AppShell.tsx");
  for (const token of [
    "日常运营",
    "周期复盘",
    "管理设置",
    "aria-current",
    "aria-expanded",
    "退出",
  ]) {
    assert.match(shell, new RegExp(token));
  }
  assert.doesNotMatch(shell, /showToast|usePrototypeFeedback|DepartmentScopePicker/);
  assert.doesNotMatch(shell, /快速新建|新建事项|您目前没有新的系统通知/);
  assert.doesNotMatch(shell, /index===4|risk-count/);
});

test("protected providers stop page data work before role authorization", async () => {
  const providers = await read("../app/providers.tsx");
  assert.match(providers, /ProtectedAppProviders/);
  assert.match(providers, /<SessionGate>/);
});

test("Recovery A visual layer retains the approved hotel console language", async () => {
  const globals = await read("../app/globals.css");
  const css = await read("../app/recovery-a.css");
  assert.match(globals, /recovery-a\.css/);
  for (const token of [
    "--ivory",
    "--ink",
    "--champagne",
    "--teal",
    "--coral",
    "@media(max-width:1024px)",
    "min-height:44px",
    "focus-visible",
  ]) {
    assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
