import { getBetterAuth } from "../../../lib/auth/better-auth.ts";

async function handle(request: Request) {
  return getBetterAuth().handler(request);
}

export const GET = handle;
export const POST = handle;
