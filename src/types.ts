export type Role = 'rabbi' | 'assistant' | 'community';
export type Affiliation = 'shul_member' | 'beis_hatalmud' | 'mosdos' | 'other';

export const AFFILIATION_LABELS: Record<Affiliation, string> = {
  shul_member: 'Shul member',
  beis_hatalmud: 'Beis Hatalmud',
  mosdos: 'Mosdos',
  other: 'Other',
};

export interface Profile {
  id: string;
  role: Role;
  full_name: string;
  phone: string | null;
  affiliation: Affiliation | null;
  /** Which mosad, when affiliation is 'mosdos' — "Jewish High" tells the Rov far more than "mosdos". */
  organisation: string | null;
  is_active: boolean;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  default_same_day: boolean;
  is_sensitive: boolean;
  sort_order: number;
  is_active?: boolean;
}

export interface UrgencyTier {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active?: boolean;
  promise_type?: 'same_day' | 'hours' | 'queue_based';
  promise_hours?: number | null;
}

export type ShailahStatus = 'new' | 'triaged' | 'in_progress' | 'answered' | 'closed' | 'withdrawn';

export interface Shailah {
  id: string;
  ref: string;
  profile_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  channel: 'app' | 'sms' | 'whatsapp' | 'staff';
  category_id: string | null;
  urgency_tier_id: string | null;
  question: string;
  status: ShailahStatus;
  answer: string | null;
  answered_at: string | null;
  due_at: string | null;
  expected_reply_text: string | null;
  is_sensitive: boolean;
  ai_suggested_category_id: string | null;
  ai_suggested_urgency_id: string | null;
  ai_summary: string | null;
  ai_confidence: number | null;
  triage_confirmed_at: string | null;
  created_at: string;
}

export type BookingStatus = 'requested' | 'confirmed' | 'declined' | 'rescheduled' | 'cancelled' | 'completed';

export interface Booking {
  id: string;
  ref: string;
  profile_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  slot_type: 'call' | 'meeting';
  starts_at: string;
  ends_at: string;
  purpose: string | null;
  status: BookingStatus;
  decline_reason: string | null;
  created_at: string;
}

export interface Slot {
  releaseId: string;
  slotType: 'call' | 'meeting';
  startsAt: string;
  endsAt: string;
  location: string | null;
}

export interface TimetableBlock {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  label: string;
  block_type: 'davening' | 'shiur' | 'school' | 'chosson' | 'family' | 'other';
  is_active: boolean;
}

export interface SlotRelease {
  id: string;
  slot_type: 'call' | 'meeting';
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  location: string | null;
  status: 'open' | 'closed';
}

/**
 * A time the Rov keeps every week — "Sunday 19:00–20:00, ten minutes each". Set once, and the
 * kehillah can book it for as long as he leaves it on. Weekday 0 = Sunday; never Shabbos.
 */
export interface Availability {
  id: string;
  slot_type: 'call' | 'meeting';
  weekday: number;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  location: string | null;
  is_active: boolean;
}

/** A date the weekly pattern doesn't run — he's away, or it's yom tov. */
export interface TimeOff {
  id: string;
  on_date: string;
  reason: string | null;
}

/** How many people a weekly window can take — the number he actually cares about. */
export function slotsInWindow(a: Pick<Availability, 'start_time' | 'end_time' | 'duration_minutes'>): number {
  const mins = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  };
  return Math.max(0, Math.floor((mins(a.end_time) - mins(a.start_time)) / a.duration_minutes));
}

export interface Settings {
  id: number;
  /** Where candle-lighting and zmanim are calculated for. Any Hebcal geonameid works. */
  location_name: string;
  location_geonameid: number;
  location_latitude: number;
  location_longitude: number;
  /** Two days of yom tov outside Israel, one inside. */
  in_israel: boolean;
  /** How long before candle-lighting the diary stops offering appointments. */
  erev_cutoff_minutes: number;
  calendar_synced_at: string | null;
  timezone: string;
  daily_shailah_capacity: number;
  same_day_cutoff_hour: number;
  same_day_promise_hour: number;
  calls_auto_confirm: boolean;
  meetings_auto_confirm: boolean;
  sms_notifications_enabled: boolean;
  briefing_enabled: boolean;
  rabbi_phone: string | null;
}

export type Occasion = 'sheva_brochos' | 'bar_mitzvah' | 'chanukas_habayis' | 'shloshim' | 'shiur' | 'other';

export const OCCASION_LABELS: Record<Occasion, string> = {
  sheva_brochos: 'Sheva brochos',
  bar_mitzvah: 'Bar mitzvah',
  chanukas_habayis: 'Chanukas habayis',
  shloshim: 'Shloshim / yahrtzeit',
  shiur: 'Shiur or event',
  other: 'Something else',
};

export type InvitationStatus = 'requested' | 'accepted' | 'declined' | 'cancelled';

/** An invitation for the Rov to speak — a drasha at a simcha, a shiur, an organisation event. */
export interface Invitation {
  id: string;
  ref: string;
  profile_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  channel: 'app' | 'sms' | 'whatsapp' | 'staff';
  occasion: Occasion;
  starts_at: string;
  duration_minutes: number;
  location: string | null;
  notes: string | null;
  expected_attendance: number | null;
  status: InvitationStatus;
  decline_reason: string | null;
  responded_at: string | null;
  created_at: string;
}

export type DayKind = 'weekday' | 'erev' | 'shabbos' | 'yomtov' | 'chol_hamoed' | 'fast';

/**
 * One day of the Jewish calendar, from Hebcal, for the configured location. Cached nightly —
 * see supabase/functions/rabbi-calendar.
 */
export interface CalendarDay {
  on_date: string;
  kind: DayKind;
  label: string | null;
  parsha: string | null;
  /** Work is forbidden: nothing is promised for, offered on, or texted on this day. */
  no_work: boolean;
  candles_at: string | null;
  havdalah_at: string | null;
  zmanim: Record<string, string> | null;
  hebrew_date: string | null;
}

/** The zmanim worth showing him, in the order he would read them, with plain names. */
export const ZMANIM_SHOWN: { key: string; label: string }[] = [
  { key: 'alotHaShachar', label: 'Alos' },
  { key: 'misheyakir', label: 'Misheyakir' },
  { key: 'sunrise', label: 'Netz' },
  { key: 'sofZmanShma', label: 'Sof zman krias shma' },
  { key: 'sofZmanTfilla', label: 'Sof zman tefilla' },
  { key: 'chatzot', label: 'Chatzos' },
  { key: 'minchaGedola', label: 'Mincha gedola' },
  { key: 'plagHaMincha', label: 'Plag' },
  { key: 'sunset', label: 'Shkia' },
  { key: 'tzeit7083deg', label: 'Tzeis' },
];

/** How a day should read on screen — yom tov beats Shabbos beats erev. */
export function dayTone(kind: DayKind): 'plain' | 'rest' | 'soft' {
  return kind === 'yomtov' || kind === 'shabbos' ? 'rest'
    : kind === 'erev' || kind === 'chol_hamoed' || kind === 'fast' ? 'soft'
      : 'plain';
}
