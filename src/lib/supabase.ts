import { createClient } from '@supabase/supabase-js';

// Vite inlines these at BUILD time, so they must exist in the build environment (locally in
// .env.local, on Vercel as project env vars) — adding them later needs a fresh deployment, not
// just a redeploy of the same build.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False when the build is missing its Supabase credentials; App shows a setup screen instead. */
export const isConfigured = Boolean(url && anonKey);

export const missingEnvVars = [
  !url && 'VITE_SUPABASE_URL',
  !anonKey && 'VITE_SUPABASE_ANON_KEY',
].filter(Boolean) as string[];

// createClient throws on empty credentials, which would kill the bundle before React mounts and
// leave a white screen with nothing to go on. Fall back to harmless placeholders so the app can
// load and explain itself via isConfigured.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'rabbi-app-auth',
    },
  },
);
