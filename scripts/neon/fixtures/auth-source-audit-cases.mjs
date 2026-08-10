export const rejectedAuthSourceAuditCases = [
  {
    name: "direct client business call",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient('createServerPasswordClient().from("users");'),
  },
  {
    name: "aliased client business call",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const client = createServerPasswordClient();
      const alias = client;
      alias.rpc("operation");
    `),
  },
  {
    name: "destructured client alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const { client } = { client: createServerPasswordClient() };
      client.from("users");
    `),
  },
  {
    name: "object shorthand client alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const client = createServerPasswordClient();
      const holder = { client };
      holder.client.from("users");
    `),
  },
  {
    name: "computed object-property client alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const holder = { ["client"]: createServerPasswordClient() };
      holder["client"].rpc("operation");
    `),
  },
  {
    name: "private class-field client alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      class Repository {
        #client = createServerPasswordClient();
        read() { return this.#client.from("users"); }
      }
    `),
  },
  {
    name: "chained assignment client alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      let first, second;
      first = second = createServerPasswordClient();
      first.from("users");
    `),
  },
  {
    name: "imported factory wrapper alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import { createServerPasswordClient as createAuthClient } from "../lib/supabase/server-admin.ts";
      const wrapper = createAuthClient;
      wrapper().rpc("operation");
    `,
  },
  {
    name: "Promise-all imported factory wrapper alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      const [{ createServerPasswordClient: makeClient }] = await Promise.all([
        import("../lib/supabase/server-admin.ts"),
      ]);
      makeClient().from("users");
    `,
  },
  {
    name: "imported Supabase client-wrapper alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import { createBusinessClient as makeClient } from "../lib/supabase/business-client.ts";
      makeClient().from("users");
    `,
  },
  {
    name: "unprovable imported client-wrapper alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import { createWrappedClient as makeClient } from "../lib/auth/client-wrapper.ts";
      const client = makeClient();
      client.from("users");
    `,
  },
  {
    name: "namespace stored through object shorthand",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import * as serverAdmin from "../lib/supabase/server-admin.ts";
      const holder = { serverAdmin };
      holder.serverAdmin.createServerPasswordClient().from("users");
    `,
  },
  {
    name: "optional computed business call",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const client = createServerPasswordClient();
      client?.["from"]?.("users");
    `),
  },
  {
    name: "unknown computed client alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const property = getClientProperty();
      const holder = { [property]: createServerPasswordClient() };
      holder[property].from("users");
    `),
  },
  {
    name: "conditional client alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const client = enabled ? createServerPasswordClient() : localClient;
      client.from("users");
    `),
  },
  {
    name: "unprovable call-return client alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const passthrough = value => value;
      const client = passthrough(createServerPasswordClient());
      client.from("users");
    `),
  },
  {
    name: "client passed through a local function parameter",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      function read(alias) { return alias.from("users"); }
      read(createServerPasswordClient());
    `),
  },
  {
    name: "client returned by a local wrapper",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const makeClient = () => createServerPasswordClient();
      makeClient().rpc("operation");
    `),
  },
  {
    name: "client stored in an array",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const client = createServerPasswordClient();
      const clients = [client];
      clients[0].from("users");
    `),
  },
  {
    name: "client transferred through Object.assign",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const client = createServerPasswordClient();
      const holder = Object.assign({}, { client });
      holder.client.rpc("operation");
    `),
  },
  {
    name: "computed Auth surface",
    error: "SUPABASE_AUTH_METHOD_DRIFT",
    source: serverClient(`
      const client = createServerPasswordClient();
      client["auth"].getUser("access-token");
    `),
  },
  {
    name: "optional Auth surface",
    error: "SUPABASE_AUTH_METHOD_DRIFT",
    source: serverClient(`
      const client = createServerPasswordClient();
      client.auth?.getUser("access-token");
    `),
  },
  {
    name: "unsupported Auth method through object alias",
    error: "SUPABASE_AUTH_METHOD_DRIFT",
    source: serverClient(`
      const client = createServerPasswordClient();
      const holder = { client };
      holder.client.auth.signOut();
    `),
  },
  {
    name: "password client used as a raw Storage client",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const client = createServerPasswordClient();
      client.storage.from("property-import-files").download(path);
    `),
  },
  {
    name: "actor client Storage used outside the approved adapter",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      const client = createServerActorClient(accessToken);
      client.storage.from("business-data").remove(["x"]);
    `,
  },
  {
    name: "Supabase Functions surface",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const client = createServerPasswordClient();
      client.functions.invoke("mutate");
    `),
  },
  {
    name: "destructured Supabase Functions surface",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const client = createServerPasswordClient();
      const { ["functions"]: functions } = client;
      functions.invoke("mutate");
    `),
  },
  {
    name: "assigned destructured Supabase channel surface",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const client = createServerPasswordClient();
      let channel;
      ({ channel } = client);
      channel("room").send({ type: "broadcast" });
    `),
  },
  {
    name: "destructured surface from an unprovable imported client",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import { createWrappedClient } from "../lib/auth/client-wrapper.ts";
      const client = createWrappedClient();
      const { functions } = client;
      functions.invoke("mutate");
    `,
  },
  {
    name: "Supabase Realtime channel surface",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const client = createServerPasswordClient();
      client.channel("room").send({ type: "broadcast" });
    `),
  },
  {
    name: "Supabase Realtime property surface",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const client = createServerPasswordClient();
      client.realtime.connect();
    `),
  },
  {
    name: "CommonJS destructured factory alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      const { createServerPasswordClient: makeClient } = require("../lib/supabase/server-admin.ts");
      makeClient().from("users");
    `,
  },
  {
    name: "TypeScript import-equals namespace alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import serverAdmin = require("../lib/supabase/server-admin.ts");
      serverAdmin.createServerPasswordClient().rpc("operation");
    `,
  },
  {
    name: "recursive local-return alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      function recursiveClient() { return recursiveClient(); }
      recursiveClient().from("users");
    `,
  },
  {
    name: "Storage adapter without an actor token",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway() {
        const client = createServerActorClient();
        return { remove(bucket, path) { return client.storage.from(bucket).remove([path]); } };
      }
    `,
  },
  {
    name: "Storage adapter with a false actor token",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway() {
        const client = createServerActorClient(false);
        return { remove(bucket, path) { return client.storage.from(bucket).remove([path]); } };
      }
    `,
  },
  {
    name: "Storage adapter with a zero actor token",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway() {
        const client = createServerActorClient(0);
        return { remove(bucket, path) { return client.storage.from(bucket).remove([path]); } };
      }
    `,
  },
  {
    name: "Storage adapter with a NaN actor token",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway() {
        const client = createServerActorClient(NaN);
        return { remove(bucket, path) { return client.storage.from(bucket).remove([path]); } };
      }
    `,
  },
  {
    name: "legacy business repository re-export",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: 'export { createSupabasePropertyRepository as propertyRepository } from "../repositories/supabase/property-repository.ts";',
  },
  {
    name: "browser business-client dynamic import",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: 'const browser = await import("../lib/supabase/browser.ts"); browser.createBrowserSupabaseClient();',
  },
];

export const allowedAuthSourceAuditCases = [
  {
    name: "approved Auth methods",
    source: serverClient(`
      const client = createServerPasswordClient();
      await client.auth.signInWithPassword({ email, password });
      await client.auth.getUser(accessToken);
      await client.auth.refreshSession({ refresh_token: refreshToken });
    `),
  },
  {
    name: "approved actor-token Storage adapter",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(accessToken) {
        const client = createServerActorClient(accessToken);
        return {
          upload(bucket, path, body) { return client.storage.from(bucket).upload(path, body); },
          download(bucket, path) { return client.storage.from(bucket).download(path); },
          remove(bucket, path) { return client.storage.from(bucket).remove([path]); },
        };
      }
    `,
  },
  {
    name: "shadowed local receiver",
    source: serverClient(`
      const client = createServerPasswordClient();
      function readLocalRows() {
        const client = { from() { return []; } };
        return client.from();
      }
      client.auth.getUser("access-token");
    `),
  },
  {
    name: "shadowed factory parameter",
    source: serverClient(`
      function readLocalRows(createServerPasswordClient) {
        const client = createServerPasswordClient();
        return client.from();
      }
      createServerPasswordClient().auth.getUser("access-token");
    `),
  },
  {
    name: "shadowed namespace parameter",
    source: `
      import * as serverAdmin from "../lib/supabase/server-admin.ts";
      function readLocalRows(serverAdmin) {
        return serverAdmin.createServerPasswordClient().from("local");
      }
      serverAdmin.createServerPasswordClient().auth.getUser("access-token");
    `,
  },
  {
    name: "benign object methods",
    source: `
      const localRepository = {
        from() { return []; },
        rpc() { return "local"; },
      };
      localRepository.from();
      localRepository.rpc();
    `,
  },
  {
    name: "Supabase-looking comments and strings are not imports",
    source: `
      // import { createClient } from "@supabase/supabase-js";
      const documentation = "repositories/supabase/property-repository.ts";
      const browserExample = "../lib/supabase/browser.ts";
    `,
  },
  {
    name: "unrelated browser-helper factory import",
    source: `
      import { createBrowserClient } from "../unrelated/browser-helper.ts";
      createBrowserClient();
    `,
  },
];

function serverClient(body) {
  return `
    import { createServerPasswordClient } from "../lib/supabase/server-admin.ts";
    ${body}
  `;
}
