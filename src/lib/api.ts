import { supabase } from './supabase';
import {
  demoBookings, demoCategories, demoMyShailos, demoProfile, demoRole, demoSlots, demoTiers, isDemo,
} from './demo';

// Preview mode answers every action from fixtures — nothing reaches the database, and the
// actions that would write simply report success without doing anything.
// deno-lint-ignore no-explicit-any
async function demoResponse(action: string, payload: Record<string, unknown>): Promise<any> {
  const role = demoRole() ?? 'member';
  switch (action) {
    case 'public_config':
      return { categories: demoCategories, urgencyTiers: demoTiers };
    case 'me':
      return { profile: demoProfile(role) };
    case 'slots':
      return { slots: demoSlots(payload.slotType === 'meeting' ? 'meeting' : 'call') };
    case 'book':
      return { booking: { ...demoBookings[0], ref: 'B-0029', status: payload.slotType === 'meeting' ? 'requested' : 'confirmed' } };
    case 'submit_shailah':
      return {
        shailah: {
          id: 'demo-new', ref: 'S-0044',
          due_at: new Date(Date.now() + 8 * 3_600_000).toISOString(),
          expected_reply_text: 'The Rov expects to answer later today (by this evening).',
        },
      };
    case 'my_requests':
      return { shailos: demoMyShailos, bookings: demoBookings };
    default:
      return { ok: true };
  }
}

// Thin wrapper over the rabbi-public edge function: all community writes go through it so the
// promise calculation and capacity checks live server-side (see supabase/functions/rabbi-public).
// deno-style edge errors come back as { error } with a non-2xx status.
export async function api<T = Record<string, unknown>>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (isDemo()) return demoResponse(action, payload) as Promise<T>;
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
