import { supabase } from './supabase';
import {
  demoAnswered, demoAvailability, demoBookings, demoBriefing, demoCalendar, demoCategories, demoHandedOff,
  demoInvitations, demoProfiles, demoQueue, demoSettings, demoSlotReleases, demoTimeOff,
  demoTimetable, demoTiers, isDemo,
} from './demo';
import type {
  Availability, Booking, CalendarDay, Category, Invitation, Profile, Settings, Shailah,
  SlotRelease, TimeOff, TimetableBlock, UrgencyTier,
} from '../types';

// Direct table reads/writes for the admin side — all under the rabbi_is_admin() RLS policies.
// Community-facing writes still go through the rabbi-public edge function.

export async function fetchQueue(): Promise<Shailah[]> {
  if (isDemo()) return demoQueue;

  const { data } = await supabase.from('rabbi_shailos')
    .select('*')
    .in('status', ['new', 'triaged', 'in_progress'])
    .order('due_at', { ascending: true, nullsFirst: false });
  return (data as Shailah[]) ?? [];
}

export async function fetchAnswered(limit = 30): Promise<Shailah[]> {
  if (isDemo()) return demoAnswered;

  const { data } = await supabase.from('rabbi_shailos')
    .select('*')
    .in('status', ['answered', 'closed'])
    .order('answered_at', { ascending: false })
    .limit(limit);
  return (data as Shailah[]) ?? [];
}

export async function fetchShailah(id: string): Promise<Shailah | null> {
  if (isDemo()) return [...demoQueue, ...demoAnswered].find((x) => x.id === id) ?? null;
  const { data } = await supabase.from('rabbi_shailos').select('*').eq('id', id).maybeSingle();
  return (data as Shailah | null) ?? null;
}

export async function fetchPendingMeetings(): Promise<Booking[]> {
  if (isDemo()) return demoBookings.filter((b) => b.status === 'requested');

  const { data } = await supabase.from('rabbi_bookings')
    .select('*').eq('status', 'requested').gte('starts_at', new Date().toISOString())
    .order('starts_at');
  return (data as Booking[]) ?? [];
}

export async function fetchUpcomingBookings(days = 7): Promise<Booking[]> {
  if (isDemo()) return demoBookings.filter((b) => Date.parse(b.starts_at) > Date.now());
  const { data } = await supabase.from('rabbi_bookings')
    .select('*').in('status', ['confirmed', 'requested'])
    .gte('starts_at', new Date().toISOString())
    .lte('starts_at', new Date(Date.now() + days * 86_400_000).toISOString())
    .order('starts_at');
  return (data as Booking[]) ?? [];
}

export async function fetchProfilesByIds(ids: string[]): Promise<Map<string, Profile>> {
  if (isDemo()) return new Map(Object.entries(demoProfiles));

  const map = new Map<string, Profile>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data } = await supabase.from('rabbi_profiles')
    .select('id, role, full_name, phone, affiliation, organisation, is_active').in('id', unique);
  for (const p of (data as Profile[]) ?? []) map.set(p.id, p);
  return map;
}

export async function fetchCategories(includeInactive = false): Promise<Category[]> {
  if (isDemo()) return demoCategories;
  let q = supabase.from('rabbi_categories').select('*').order('sort_order');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data } = await q;
  return (data as Category[]) ?? [];
}

export async function fetchTiers(): Promise<UrgencyTier[]> {
  if (isDemo()) return demoTiers;

  const { data } = await supabase.from('rabbi_urgency_tiers').select('*').eq('is_active', true).order('sort_order');
  return (data as UrgencyTier[]) ?? [];
}

export async function fetchTimetable(): Promise<TimetableBlock[]> {
  if (isDemo()) return demoTimetable;

  const { data } = await supabase.from('rabbi_timetable_blocks')
    .select('*').eq('is_active', true).order('weekday').order('start_time');
  return (data as TimetableBlock[]) ?? [];
}

export async function fetchSlotReleases(): Promise<SlotRelease[]> {
  if (isDemo()) return demoSlotReleases;

  const { data } = await supabase.from('rabbi_slot_releases')
    .select('*').gte('ends_at', new Date().toISOString()).order('starts_at');
  return (data as SlotRelease[]) ?? [];
}

export async function fetchAvailability(): Promise<Availability[]> {
  if (isDemo()) return demoAvailability;
  const { data } = await supabase.from('rabbi_availability')
    .select('*').eq('is_active', true).order('weekday').order('start_time');
  return (data as Availability[]) ?? [];
}

export async function fetchTimeOff(): Promise<TimeOff[]> {
  if (isDemo()) return demoTimeOff;
  const today = new Date();
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const { data } = await supabase.from('rabbi_time_off').select('*').gte('on_date', key).order('on_date');
  return (data as TimeOff[]) ?? [];
}

/** The Jewish calendar for a window of dates — yom tov, candle-lighting, zmanim. */
export async function fetchCalendar(fromDate: string, toDate: string): Promise<Map<string, CalendarDay>> {
  const rows = isDemo()
    ? demoCalendar.filter((d) => d.on_date >= fromDate && d.on_date <= toDate)
    : ((await supabase.from('rabbi_calendar_days').select('*')
        .gte('on_date', fromDate).lte('on_date', toDate).order('on_date')).data as CalendarDay[]) ?? [];
  return new Map(rows.map((d) => [d.on_date, d]));
}

export async function fetchSettings(): Promise<Settings | null> {
  if (isDemo()) return demoSettings;

  const { data } = await supabase.from('rabbi_settings').select('*').eq('id', 1).maybeSingle();
  return (data as Settings | null) ?? null;
}

export async function fetchLatestBriefing(): Promise<string | null> {
  if (isDemo()) return demoBriefing;

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const { data } = await supabase.from('rabbi_messages')
    .select('body').eq('related_type', 'briefing').eq('kind', 'daily')
    .gte('created_at', dayStart.toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return (data?.body as string | undefined) ?? null;
}

export async function fetchHandedOffConversations(): Promise<{ id: string; phone: string; updated_at: string }[]> {
  if (isDemo()) return demoHandedOff;
  // Through a function, not the table: a helper needs to know somebody wants ringing back, and
  // must not be handed the words they texted to get there.
  const { data } = await supabase.rpc('rabbi_handed_off_lines');
  return (data as { id: string; phone: string; updated_at: string }[]) ?? [];
}

export async function fetchInvitations(): Promise<Invitation[]> {
  if (isDemo()) return demoInvitations;
  const { data } = await supabase.from('rabbi_invitations')
    .select('*').order('starts_at');
  return (data as Invitation[]) ?? [];
}

export async function fetchPendingInvitations(): Promise<Invitation[]> {
  if (isDemo()) return demoInvitations.filter((i) => i.status === 'requested');
  const { data } = await supabase.from('rabbi_invitations')
    .select('*').eq('status', 'requested').gte('starts_at', new Date().toISOString())
    .order('starts_at');
  return (data as Invitation[]) ?? [];
}

/**
 * Does this invitation collide with the Rov's fixed week? He should never accept a drasha
 * without being shown that his chosson lesson is at the same time.
 */
export function findClash(
  startsAt: string,
  durationMinutes: number,
  blocks: TimetableBlock[],
): TimetableBlock | null {
  const start = new Date(startsAt);
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = startMin + durationMinutes;
  const weekday = start.getDay();
  return blocks.find((b) => {
    if (b.weekday !== weekday || !b.is_active) return false;
    const [bh, bm] = b.start_time.split(':').map(Number);
    const [eh, em] = b.end_time.split(':').map(Number);
    return startMin < eh * 60 + em && endMin > bh * 60 + bm;
  }) ?? null;
}

// ---------------------------------------------------------------------------
// The text-in line, in full.
//
// A shailah only exists once somebody replies YES, and a booking only once they pick a time — so
// every conversation that stopped short of that used to leave no trace the Rov could see. These
// two reads are the trace: every text in and out, whether or not it ever became anything.

export interface ConversationRow {
  id: string;
  phone: string;
  state: string;
  intent: string | null;
  draft: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  profile_id: string | null;
}

export interface ConversationMessage {
  id: string;
  direction: 'in' | 'out';
  body: string;
  created_at: string;
  status: string | null;
  error: string | null;
}

export async function fetchConversations(limit = 60): Promise<ConversationRow[]> {
  if (isDemo()) return [];
  const { data } = await supabase.from('rabbi_conversations')
    .select('id, phone, state, intent, draft, created_at, updated_at, profile_id')
    .order('updated_at', { ascending: false }).limit(limit);
  return (data as ConversationRow[]) ?? [];
}

export async function fetchConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
  if (isDemo()) return [];
  const { data } = await supabase.from('rabbi_messages')
    .select('id, direction, body, created_at, status, error')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  return (data as ConversationMessage[]) ?? [];
}

/** Whatever a conversation actually produced, so "nothing came of this" is a fact and not a guess. */
export async function fetchConversationOutcomes(
  conversationIds: string[],
): Promise<Map<string, { shailos: string[]; bookings: string[] }>> {
  const out = new Map<string, { shailos: string[]; bookings: string[] }>();
  if (isDemo() || !conversationIds.length) return out;
  const { data } = await supabase.from('rabbi_messages')
    .select('conversation_id, related_type, related_id')
    .in('conversation_id', conversationIds)
    .in('related_type', ['shailah', 'booking']);
  for (const m of (data ?? []) as { conversation_id: string; related_type: string; related_id: string }[]) {
    if (!m.related_id) continue;
    const e = out.get(m.conversation_id) ?? { shailos: [], bookings: [] };
    const list = m.related_type === 'shailah' ? e.shailos : e.bookings;
    if (!list.includes(m.related_id)) list.push(m.related_id);
    out.set(m.conversation_id, e);
  }
  return out;
}
