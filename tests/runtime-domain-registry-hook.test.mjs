import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveRuntimeDomainRegistryState,
} from "../app/repositories/runtime/use-runtime-domain-registry.ts";

test("runtime registry state exposes the selected registry after a successful load", async () => {
  const registry = { source: "neon" };

  assert.deepEqual(
    await resolveRuntimeDomainRegistryState(async () => registry),
    { registry, error: null },
  );
});

test("runtime registry state preserves a Neon loader failure without constructing a fallback", async () => {
  const failure = new Error("Neon unavailable");

  const state = await resolveRuntimeDomainRegistryState(async () => {
    throw failure;
  });

  assert.equal(state.registry, null);
  assert.equal(state.error, failure);
});
