import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { parseAppEnvironment } from "./app/lib/environment";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ mode }) => {
  const environment = parseAppEnvironment({ ...loadEnv(mode, process.cwd(), ""), ...process.env });
  const browserEnvironmentDefines = {
    "process.env.APP_ENV": JSON.stringify(environment.appEnv),
    "process.env.APP_DATA_MODE": JSON.stringify(environment.dataMode),
    "process.env.APP_BASE_DOMAIN": JSON.stringify(environment.appBaseDomain),
    "process.env.DEV_PROPERTY_HOSTNAME": JSON.stringify(environment.devPropertyHostname ?? ""),
    "process.env.PREVIEW_PROPERTY_HOSTNAME": JSON.stringify(environment.previewPropertyHostname ?? ""),
    "process.env.VERCEL_ENV": JSON.stringify(process.env.VERCEL_ENV ?? ""),
    "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(environment.supabaseUrl ?? ""),
    "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(environment.supabasePublishableKey ?? ""),
  };

  const isVercelDeployment =
    process.env.VERCEL === "1" || process.env.NITRO_PRESET === "vercel";

  if (isVercelDeployment) {
    const { nitro } = await import("nitro/vite");
    const { default: tailwindcss } = await import("@tailwindcss/postcss");

    return {
      define: browserEnvironmentDefines,
      css: {
        postcss: {
          plugins: [tailwindcss()],
        },
      },
      plugins: [vinext(), nitro()],
    };
  }

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    define: browserEnvironmentDefines,
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
