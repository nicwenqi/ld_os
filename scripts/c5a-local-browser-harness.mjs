import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const command = process.argv[2];
const root = fileURLToPath(new URL("..", import.meta.url));

if (command === "prepare") {
  const password = `${randomBytes(24).toString("base64url")}Aa1!`;
  const fixture = readFileSync(
    new URL("../supabase/snippets/c5a_local_browser_auth_fixture.sql", import.meta.url),
  );
  run("docker", [
    "exec", "-i", "supabase_db_hotel-ld-os",
    "psql", "-v", "ON_ERROR_STOP=1", "-v", `c5a_password=${password}`,
    "-U", "postgres", "-d", "postgres",
  ], fixture);
  process.stdout.write(
    "C5-A local Auth fixture ready: c5a-manager / c5a-department.\n"
      + `One-time local review password: ${password}\n`
      + "Destroy the environment with cleanup after browser verification.\n",
  );
} else if (command === "cleanup") {
  run("npx", ["--no-install", "supabase", "stop", "--no-backup"]);
  process.stdout.write("C5-A disposable local Supabase data removed.\n");
} else if (command === "serve") {
  const local = readLocalSupabaseEnvironment();
  run(
    "npm",
    ["run", "dev", "--", "--host", "127.0.0.1", "--port", process.env.C5A_PORT ?? "4173"],
    undefined,
    {
      APP_ENV: "local",
      APP_DATA_MODE: "supabase",
      DEV_PROPERTY_HOSTNAME: "demo-a1.example.test",
      NEXT_PUBLIC_SUPABASE_URL: local.API_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
      SUPABASE_SECRET_KEY: local.SECRET_KEY,
    },
  );
} else {
  process.stderr.write("Usage: node scripts/c5a-local-browser-harness.mjs prepare|serve|cleanup\n");
  process.exitCode = 2;
}

function readLocalSupabaseEnvironment() {
  const result = spawnSync("npx", ["--no-install", "supabase", "status", "-o", "env"], {
    cwd: root,
    encoding: "utf8",
    env: harnessEnvironment(),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "Unable to read local Supabase status.\n");
    process.exit(result.status ?? 1);
  }
  const values = Object.fromEntries(
    result.stdout.split("\n").flatMap((line) => {
      const match = line.match(/^([A-Z_]+)="(.*)"$/);
      return match ? [[match[1], match[2]]] : [];
    }),
  );
  for (const key of ["API_URL", "PUBLISHABLE_KEY", "SECRET_KEY"]) {
    if (!values[key]) throw new Error(`Local Supabase status is missing ${key}`);
  }
  return values;
}

function harnessEnvironment(extra = {}) {
  return {
    ...process.env,
    HOME: process.env.C5A_SUPABASE_HOME ?? "/tmp/codex-supabase",
    DO_NOT_TRACK: "1",
    ...extra,
  };
}

function run(executable, args, input, environment = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    input,
    stdio: input ? ["pipe", "inherit", "inherit"] : "inherit",
    env: harnessEnvironment(environment),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
