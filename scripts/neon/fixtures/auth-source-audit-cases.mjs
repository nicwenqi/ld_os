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
    name: "Storage adapter with a void actor token",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      import "server-only";
      export function createActorStorageGateway(client) {
        return { remove(bucket, path) { return client.storage.from(bucket).remove([path]); } };
      }
      createActorStorageGateway(createServerActorClient(void 0));
    `,
  },
  {
    name: "Storage adapter with an object actor token",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(client) {
        return { remove(bucket, path) { return client.storage.from(bucket).remove([path]); } };
      }
      createActorStorageGateway(createServerActorClient({ accessToken }));
    `,
  },
  {
    name: "Storage adapter with an unproven token factory",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(client) {
        return { remove(bucket, path) { return client.storage.from(bucket).remove([path]); } };
      }
      createActorStorageGateway(createServerActorClient(getAccessToken()));
    `,
  },
  {
    name: "approved Storage adapter with a client alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(client) {
        const alias = client;
        return { remove(bucket, path) { return alias.storage.from(bucket).remove([path]); } };
      }
      createActorStorageGateway(createServerActorClient(accessToken));
    `,
  },
  {
    name: "approved Storage adapter with a non-Storage client surface",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(client) {
        client.functions.invoke("mutate");
        return { remove(bucket, path) { return client.storage.from(bucket).remove([path]); } };
      }
      createActorStorageGateway(createServerActorClient(accessToken));
    `,
  },
  {
    name: "approved Storage adapter with an unapproved Storage method",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(client) {
        return { list(bucket) { return client.storage.from(bucket).list(); } };
      }
      createActorStorageGateway(createServerActorClient(accessToken));
    `,
  },
  {
    name: "approved Storage adapter exposes raw Storage surface",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(client) {
        return client.storage;
      }
      createActorStorageGateway(createServerActorClient(accessToken));
    `,
  },
  {
    name: "approved Storage adapter with optional client access",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(client) {
        return { remove(bucket, path) { return client?.storage.from(bucket).remove([path]); } };
      }
      createActorStorageGateway(createServerActorClient(accessToken));
    `,
  },
  {
    name: "approved Storage adapter with optional terminal access",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(client) {
        return { remove(bucket, path) { return client.storage.from?.(bucket).remove([path]); } };
      }
      createActorStorageGateway(createServerActorClient(accessToken));
    `,
  },
  {
    name: "renamed Storage adapter receiver exposes business surface",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(storage) {
        return storage.from("business");
      }
      createActorStorageGateway(createServerActorClient(accessToken));
    `,
  },
  {
    name: "renamed Storage adapter receiver lists objects",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(actor) {
        return { list(bucket) { return actor.storage.from(bucket).list(); } };
      }
      createActorStorageGateway(createServerActorClient(accessToken));
    `,
  },
  {
    name: "renamed Storage adapter receiver uses non-Storage surface",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(actor) {
        actor.channel("room");
        return { remove(bucket, path) { return actor.storage.from(bucket).remove([path]); } };
      }
      createActorStorageGateway(createServerActorClient(accessToken));
    `,
  },
  {
    name: "Storage adapter without a bound receiver parameter",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway() {
        return client.storage.from("business").remove(["path"]);
      }
      createActorStorageGateway(createServerActorClient(accessToken));
    `,
  },
  {
    name: "Storage token alias is undefined",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(client) {
        return { remove(bucket, path) { return client.storage.from(bucket).remove([path]); } };
      }
      const token = undefined;
      createActorStorageGateway(createServerActorClient(token));
    `,
  },
  {
    name: "Storage token alias is false",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(client) {
        return { remove(bucket, path) { return client.storage.from(bucket).remove([path]); } };
      }
      const token = false;
      createActorStorageGateway(createServerActorClient(token));
    `,
  },
  {
    name: "Storage token alias is empty",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(client) {
        return { remove(bucket, path) { return client.storage.from(bucket).remove([path]); } };
      }
      const token = "";
      createActorStorageGateway(createServerActorClient(token));
    `,
  },
  {
    name: "Storage token alias is NaN",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(client) {
        return { remove(bucket, path) { return client.storage.from(bucket).remove([path]); } };
      }
      const token = NaN;
      createActorStorageGateway(createServerActorClient(token));
    `,
  },
  {
    name: "Storage token alias through a cast is false",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(client) {
        return { remove(bucket, path) { return client.storage.from(bucket).remove([path]); } };
      }
      const token = false as unknown as string;
      createActorStorageGateway(createServerActorClient(token));
    `,
  },
  {
    name: "approved Storage adapter has zero-argument remove",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(client) {
        return { remove(bucket) { return client.storage.from(bucket).remove(); } };
      }
      createActorStorageGateway(createServerActorClient(accessToken));
    `,
  },
  {
    name: "nested Storage adapter boundary spoof",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(client) { return {}; }
      function route() {
        function createActorStorageGateway(client) {
          return { remove(bucket, path) { return client.storage.from(bucket).remove([path]); } };
        }
        return createActorStorageGateway(createServerActorClient(accessToken));
      }
      route();
    `,
  },
  {
    name: "nested arrow Storage adapter boundary spoof",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(client) { return {}; }
      function route() {
        const createActorStorageGateway = client => ({ remove(bucket, path) {
          return client.storage.from(bucket).remove([path]);
        } });
        return createActorStorageGateway(createServerActorClient(accessToken));
      }
      route();
    `,
  },
  {
    name: "logical assignment factory alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      let client;
      client ||= createServerPasswordClient();
      client.from("users");
    `),
  },
  {
    name: "bound factory alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const make = createServerPasswordClient.bind(null);
      make().rpc("operation");
    `),
  },
  {
    name: "getter returns Supabase client",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      class Repository {
        get client() { return createServerPasswordClient(); }
      }
      new Repository().client.from("users");
    `),
  },
  {
    name: "external class field receives Supabase client",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      class Repository { read() { return this.client.from("users"); } }
      const repository = new Repository();
      repository.client = createServerPasswordClient();
      repository.read();
    `),
  },
  {
    name: "array pop client alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const clients = [createServerPasswordClient()];
      clients.pop().from("users");
    `),
  },
  {
    name: "array spread client alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const clients = [createServerPasswordClient()];
      const copied = [...clients];
      copied[0].rpc("operation");
    `),
  },
  {
    name: "array reverse client alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const clients = [createServerPasswordClient()];
      clients.reverse()[0].from("users");
    `),
  },
  {
    name: "array splice client alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const clients = [createServerPasswordClient()];
      clients.splice(0, 1)[0].rpc("operation");
    `),
  },
  {
    name: "for-of client alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const clients = [createServerPasswordClient()];
      for (const client of clients) client.from("users");
    `),
  },
  {
    name: "constructor parameter client alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      class Repository {
        constructor(client) { this.client = client; }
        read() { return this.client.rpc("operation"); }
      }
      new Repository(createServerPasswordClient()).read();
    `),
  },
  {
    name: "import-equals namespace wrapper",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import serverAdmin = require("../lib/supabase/server-admin.ts");
      const wrapper = serverAdmin;
      wrapper.createServerPasswordClient().from("users");
    `,
  },
  {
    name: "dynamic server-admin namespace import",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      const admin = await import("../lib/supabase/server-admin.ts");
      admin.createServerPasswordClient().rpc("operation");
    `,
  },
  {
    name: "dynamic server-admin Auth import",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      const [{ createServerPasswordClient }] = await Promise.all([
        import("../lib/supabase/server-admin.ts"),
      ]);
      createServerPasswordClient().auth.getUser("token");
    `,
  },
  {
    name: "dynamic template server-admin import",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      const [{ createServerPasswordClient }] = await Promise.all([
        import(\`../lib/supabase/server-admin.ts\`),
      ]);
      createServerPasswordClient().from("users");
    `,
  },
  {
    name: "dynamic interpolated server-admin import",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      const moduleName = "server-admin";
      const admin = await import(\`../lib/supabase/\${moduleName}.ts\`);
      admin.createServerPasswordClient().from("users");
    `,
  },
  {
    name: "approved Auth dynamic template server-admin import",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "authenticationService",
    source: `
      const email = deriveDeterministicAuthEmail(loginId, hostname);
      export type { NeonAuthorizationFacts } from "../repositories/neon/authorization-session-repository.ts";
      export function createLoginResolutionDependencies() {}
      export async function resolveLoginWith() {}
      export async function resolveAccountForLogin() {
        const [{ createServerPasswordClient }] = await Promise.all([
          import(\`../lib/supabase/server-admin.ts\`),
        ]);
        return createServerPasswordClient().from("users");
      }
    `,
  },
  {
    name: "dynamic require server-admin client",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      const admin = require("../lib/supabase/server-admin.ts");
      admin.createServerPasswordClient().from("users");
    `,
  },
  {
    name: "Supabase SSR namespace import",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import * as ssr from "@supabase/ssr";
      ssr.createServerClient(url, key).from("users");
    `,
  },
  {
    name: "Supabase SSR default import",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import ssr from "@supabase/ssr";
      ssr.createServerClient(url, key).rpc("operation");
    `,
  },
  {
    name: "Supabase SSR CommonJS computed import",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      const ssr = require("@supabase/ssr");
      ssr["createServerClient"](url, key).from("users");
    `,
  },
  {
    name: "legacy repository barrel path",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: 'export { propertyRepository } from "../repositories/legacy/../supabase/index.ts";',
  },
  {
    name: "cyclic Supabase aliases",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      let first, second;
      first = createServerPasswordClient();
      second = first;
      first = second;
      first.from("users");
    `),
  },
  {
    name: "recursive arrow client alias",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      const recursiveClient = () => recursiveClient();
      recursiveClient().from("users");
    `),
  },
  {
    name: "mutual recursive client aliases",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      function first() { return second(); }
      function second() { return first(); }
      first().rpc("operation");
    `),
  },
  {
    name: "multi-return recursive client aliases",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      function recursiveClient(flag) {
        if (flag) return recursiveClient(false);
        return recursiveClient(true);
      }
      recursiveClient(true).from("users");
    `),
  },
  {
    name: "recursive client through local function",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      function local() { return recursiveClient(); }
      function recursiveClient() { return local(); }
      recursiveClient().rpc("operation");
    `),
  },
  {
    name: "recursive multi-return cycle after benign branch",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: serverClient(`
      function benign() { return {}; }
      function recursiveClient(flag) {
        if (flag) return benign();
        return local();
      }
      function local() { return recursiveClient(false); }
      recursiveClient(false).from("users");
    `),
  },
  {
    name: "unknown imported client wrapper method",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import { makeClient as wrapper } from "../lib/unknown/client-wrapper.ts";
      wrapper().auth.getUser("token");
    `,
  },
  {
    name: "unknown imported wrapper returned through a local function",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import { make } from "../unrelated/factory.ts";
      function get() { return make(); }
      get().from("users");
    `,
  },
  {
    name: "unknown imported wrapper conditional return",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import { make } from "../unrelated/factory.ts";
      function get(flag) { if (flag) return make(); return make(); }
      get(true).from("users");
    `,
  },
  {
    name: "unknown imported wrapper conditional expression return",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import { make } from "../unrelated/factory.ts";
      const localClient = { from() { return []; } };
      function get(ok) { return ok ? make() : localClient; }
      get(true).from("users");
    `,
  },
  {
    name: "unknown imported wrapper function chain",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import { make } from "../unrelated/factory.ts";
      function first() { return make(); }
      function second() { return first(); }
      second().rpc("operation");
    `,
  },
  {
    name: "unknown imported wrapper object method holder",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import { make } from "../unrelated/factory.ts";
      const holder = { get() { return make(); } };
      holder.get().from("users");
    `,
  },
  {
    name: "spoofed Storage adapter in active route",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(accessToken) {
        const client = createServerActorClient(accessToken);
        return { remove(bucket, path) { return client.storage.from(bucket).remove([path]); } };
      }
    `,
  },
  {
    name: "legacy actor-token Storage adapter in active Import path",
    error: "SUPABASE_BUSINESS_AUTH_DRIFT",
    sourceName: "neonImportStagingAuthorization",
    source: `
      import "server-only";
      import { createServerActorClient } from "../lib/supabase/server-admin.ts";
      export function createActorStorageGateway(client) {
        return {
          upload(bucket, path, body) { return client.storage.from(bucket).upload(path, body); },
          download(bucket, path) { return client.storage.from(bucket).download(path); },
          remove(bucket, path) { return client.storage.from(bucket).remove([path]); },
        };
      }
      createActorStorageGateway(createServerActorClient(accessToken));
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
    name: "unrelated browser-helper import",
    source: `
      import { createBrowserClient } from "../unrelated/browser-helper.ts";
      createBrowserClient();
    `,
  },
  {
    name: "recursive benign local function",
    source: `
      function recursiveClient() { return recursiveClient(); }
      recursiveClient();
    `,
  },
  {
    name: "recursive-name shadow remains benign",
    source: `
      function recursiveClient() { return recursiveClient(); }
      function read(recursiveClient) { return recursiveClient().from("local"); }
      read(() => ({ from() { return []; } }));
    `,
  },
  {
    name: "unrelated ImportEquals node path remains benign",
    source: `
      import nodePath = require("node:path");
      nodePath.join("a", "b");
    `,
  },
  {
    name: "cross-scope alias names remain benign",
    source: `
      function readLocal() {
        let first, second;
        first = second;
        second = first;
        return first.from("local");
      }
      readLocal();
    `,
  },
];

function serverClient(body) {
  return `
    import { createServerPasswordClient } from "../lib/supabase/server-admin.ts";
    ${body}
  `;
}
