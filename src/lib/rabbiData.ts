import { supabase } from './supabase';
import type { Booking, Category, Profile, Settings, Shailah, SlotRelease, TimetableBlock, UrgencyTier } from '../types';

// Direct table reads/writes for the admin side — all under the rabbi_is_admin() RLS policies.
// Community-facing writes still go through the rabbi-public edge function.

export async function fetchQueue(): Promise<Shailah[]> {
  const { data } = await supabase.from('rabbi_shailos')
    .select('*')
    .in('status', ['new', 'triaged', 'in_progress'])
    .order('due_at', { ascending: true, nullsFirst: false });
  return (data as Shailah[]) ?? [];
}

export async function fetchAnswered(limit = 30): Promise<Shailah[]> {
  const { data } = await supabase.from('rabbi_shailos')
    .select('*')
    .in('status', ['answered', 'closed'])
    .order('answered_at', { ascending: false })
    .limit(limit);
  return (data as Shailah[]) ?? [];
}

export async function fetchShailah(id: string): Promise<Shailah | null> {
  const { data } = await supabase.from('rabbi_shailos').select('*').eq('id', id).maybeSingle();
  return (data as Shailah | null) ?? null;
}

export async function fetchPendingMeetings(): Promise<Booking[]> {
  const { data } = await supabase.from('rabbi_bookings')
    .select('*').eq('status', 'requested').gte('starts_at', new Date().toISOString())
    .order('starts_at');
  return (data as Booking[]) ?? [];
}

export async function fetchUpcomingBookings(days = 7): Promise<Booking[]> {
  const { data } = await supabase.from('rabbi_bookings')
    .select('*').in('status', ['confirmed', 'requested'])
    .gte('starts_at', new Date().toISOString())
    .lte('starts_at', new Date(Date.now() + days * 86_400_000).toISOString())
    .order('starts_at');
  return (data as Booking[]) ?? [];
}

export async function fetchProfilesByIds(ids: string[]): Promise<Map<string, Profile>> {
  const map = new Map<string, Profile>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data } = await supabase.from('rabbi_profiles')
    .select('id, role, full_name, phone, affiliation, is_active').in('id', unique);
  for (const p of (data as Profile[]) ?? []) map.set(p.id, p);
  return map;
}

export async function fetchCategories(includeInactive = false): Promise<Category[]> {
  let q = supabase.from('rabbi_categories').select('*').order('sort_order');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data } = await q;
  return (data as Category[]) ?? [];
}

export async function fetchTiers(): Promise<UrgencyTier[]> {
  const { data } = await supabase.from('rabbi_urgency_tiers').select('*').eq('is_active', true).order('sort_order');
  return (data as UrgencyTier[]) ?? [];
}

export async function fetchTimetable(): Promise<TimetableBlock[]> {
  const { data } = await supabase.from('rabbi_timetable_blocks')
    .select('*').eq('is_active', true).order('weekday').order('start_time');
  return (data as TimetableBlock[]) ?? [];
}

export async function fetchSlotReleases(): Promise<SlotRelease[]> {
  const { data } = await supabase.from('rabbi_slot_releases')
    .select('*').gte('ends_at', new Date().toISOString()).order('starts_at');
  return (data as SlotRelease[]) ?? [];
}

export async function fetchSettings(): Promise<Settings | null> {
  const { data } = await supabase.from('rabbi_settings').select('*').eq('id', 1).maybeSingle();
  return (data as Settings | null) ?? null;
}

export async function fetchLatestBriefing(): Promise<string | null> {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const { data } = await supabase.from('rabbi_messages')
    .select('body').eq('related_type', 'briefing').eq('kind', 'daily')
    .gte('created_at', dayStart.toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return (data?.body as string | undefined) ?? null;
}

export async function fetchHandedOffConversations(): Promise<{ id: string; phone: string; updated_at: string }[]> {
  const { data } = await supabase.from('rabbi_conversations')
    .select('id, phone, updated_at').eq('state', 'handed_off').order('updated_at', { ascending: false });
  return (data as { id: string; phone: string; updated_at: string }[]) ?? [];
}
