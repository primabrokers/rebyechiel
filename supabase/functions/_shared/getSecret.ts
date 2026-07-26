import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const adminClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const cache = new Map<string, { value: string | null; expires: number }>();
const TTL_MS = 60_000;

export async function getSecret(name: string): Promise<string | null> {
  const now = Date.now();
  const cached = cache.get(name);
  if (cached && cached.expires > now) return cached.value;

  const fromEnv = Deno.env.get(name);
  if (fromEnv) {
    cache.set(name, { value: fromEnv, expires: now + TTL_MS });
    return fromEnv;
  }

  try {
    const { data, error } = await adminClient.rpc('get_secret', { secret_name: name });
    if (!error && data) {
      cache.set(name, { value: data as string, expires: now + TTL_MS });
      return data as string;
    }
  } catch (_) {
    // ignore, fall through
  }

  cache.set(name, { value: null, expires: now + TTL_MS });
  return null;
}

export function clearSecretCache(name?: string) {
  if (name) cache.delete(name);
  else cache.clear();
}
