import { supabase } from './supabase';

// Thin wrapper over the rabbi-public edge function: all community writes go through it so the
// promise calculation and capacity checks live server-side (see supabase/functions/rabbi-public).
// deno-style edge errors come back as { error } with a non-2xx status.
export async function api<T = Record<string, unknown>>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke('rabbi-public', {
    body: { action, ...payload },
  });
  if (error) {
    // supabase-js wraps non-2xx into FunctionsHttpError with the response attached.
    // deno-lint-ignore no-explicit-any
    const ctx = (error as any)?.context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json().catch(() => null);
      throw new Error(body?.error ?? error.message);
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}

export async function otpRequest(phone: string, mode: 'login' | 'signup') {
  const { data, error } = await supabase.functions.invoke('rabbi-otp-request', { body: { phone, mode } });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; sent: boolean; registered: boolean; error?: string };
}

export async function otpVerify(
  phone: string,
  code: string,
  signup?: { fullName: string; affiliation: string },
) {
  const { data, error } = await supabase.functions.invoke('rabbi-otp-verify', { body: { phone, code, signup } });
  if (error) {
    // deno-lint-ignore no-explicit-any
    const ctx = (error as any)?.context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json().catch(() => null);
      throw new Error(body?.error ?? error.message);
    }
    throw new Error(error.message);
  }
  const res = data as { verified: boolean; needsSignup?: boolean; email?: string; tokenHash?: string; verificationType?: string; error?: string };
  if (!res.verified) throw new Error(res.error ?? 'invalid_code');
  if (res.needsSignup) return { needsSignup: true as const };
  const { error: sessionErr } = await supabase.auth.verifyOtp({
    token_hash: res.tokenHash!,
    type: (res.verificationType ?? 'magiclink') as 'magiclink',
  });
  if (sessionErr) throw new Error(sessionErr.message);
  return { needsSignup: false as const };
}
