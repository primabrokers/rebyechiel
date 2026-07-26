// Auth gate for cron-invoked functions (verify_jwt=false): accept either the service-role key
// as a Bearer token (manual invocations, tests) or the x-cron-secret header set by
// public.trigger_edge_function from the vault.
import { getSecret } from "./getSecret.ts";

export async function isCronAuthorised(req: Request): Promise<boolean> {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (bearer && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const given = req.headers.get("x-cron-secret");
  if (!given) return false;
  const secret = await getSecret("CRON_INTERNAL_SECRET");
  return Boolean(secret && given === secret);
}
