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

export interface Settings {
  id: number;
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
