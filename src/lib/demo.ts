// Preview mode — click through the whole app with realistic sample data and no login.
//
// Everything here is invented. Preview mode never reads or writes the database: the data layer
// short-circuits to these fixtures, and every action is a no-op. That makes it safe to leave
// enabled on the live site — you cannot see a real person's shailah or change anything from it.
// A banner sits at the top of every screen so it is never mistaken for the real thing.
//
// Turn it on with ?preview=rabbi or ?preview=member (or from the /preview screen). The choice
// sticks for the browser tab, so navigating around keeps you in preview.

import type {
  Availability, Booking, Category, Invitation, Profile, Settings, Shailah, SlotRelease, TimeOff,
  TimetableBlock, UrgencyTier,
} from '../types';

export type DemoRole = 'rabbi' | 'member';

const KEY = 'rabbi-app-preview';

/** Reads ?preview= from the URL (and remembers it for the tab), else whatever was chosen before. */
export function demoRole(): DemoRole | null {
  if (typeof window === 'undefined') return null;
  const param = new URLSearchParams(window.location.search).get('preview');
  if (param === 'rabbi' || param === 'member') {
    sessionStorage.setItem(KEY, param);
    return param;
  }
  if (param === 'off') {
    sessionStorage.removeItem(KEY);
    return null;
  }
  const stored = sessionStorage.getItem(KEY);
  return stored === 'rabbi' || stored === 'member' ? stored : null;
}

export function isDemo(): boolean {
  return demoRole() !== null;
}

export function exitDemo() {
  sessionStorage.removeItem(KEY);
  window.location.href = '/';
}

// --- helpers so the sample data always looks like today -----------------------------------
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
/** Today at a given local time, for due dates that should read as "due today". */
function todayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}
/** The next occurrence of a weekday at a given hour — keeps sample bookings in the future. */
function nextWeekdayAt(weekday: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  const delta = (weekday - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d.toISOString();
}

const CAT = {
  niddah: 'demo-cat-niddah',
  kashrus: 'demo-cat-kashrus',
  shabbos: 'demo-cat-shabbos',
  business: 'demo-cat-business',
  chinuch: 'demo-cat-chinuch',
  shalom: 'demo-cat-shalom',
  aveilus: 'demo-cat-aveilus',
  simcha: 'demo-cat-simcha',
  other: 'demo-cat-other',
} as const;
const TIER = { urgent: 'demo-tier-urgent', soon: 'demo-tier-soon', standard: 'demo-tier-standard' } as const;
const PROFILE = { rov: 'demo-profile-rov', dovid: 'demo-profile-dovid', rivky: 'demo-profile-rivky', yosef: 'demo-profile-yosef' } as const;

export const demoCategories: Category[] = [
  { id: CAT.niddah, slug: 'niddah', name: 'Niddah / Taharas Hamishpacha', description: 'Answered the same day. Handled with complete discretion.', default_same_day: true, is_sensitive: true, sort_order: 1, is_active: true },
  { id: CAT.kashrus, slug: 'kashrus', name: 'Kashrus', description: 'Kitchen mix-ups, products, eating out.', default_same_day: false, is_sensitive: false, sort_order: 2, is_active: true },
  { id: CAT.shabbos, slug: 'shabbos', name: 'Shabbos & Yom Tov', description: 'Muktzeh, eruv, medicines, appliances.', default_same_day: false, is_sensitive: false, sort_order: 3, is_active: true },
  { id: CAT.business, slug: 'business', name: 'Business & money', description: 'Choshen mishpat, ribbis, contracts, disputes.', default_same_day: false, is_sensitive: false, sort_order: 4, is_active: true },
  { id: CAT.chinuch, slug: 'chinuch', name: 'Chinuch', description: 'Schooling, children, guidance for parents.', default_same_day: false, is_sensitive: false, sort_order: 5, is_active: true },
  { id: CAT.shalom, slug: 'shalom_bayis', name: 'Shalom bayis', description: 'Handled privately, by the Rov alone.', default_same_day: false, is_sensitive: true, sort_order: 6, is_active: true },
  { id: CAT.aveilus, slug: 'aveilus', name: 'Aveilus', description: 'Mourning practices and related questions.', default_same_day: false, is_sensitive: false, sort_order: 7, is_active: true },
  { id: CAT.simcha, slug: 'simcha', name: 'Simchos & life events', description: 'Weddings, brissim, bar mitzvahs.', default_same_day: false, is_sensitive: false, sort_order: 8, is_active: true },
  { id: CAT.other, slug: 'other', name: 'Something else', description: 'Anything that does not fit the above — just write it in your own words.', default_same_day: false, is_sensitive: false, sort_order: 9, is_active: true },
];

export const demoTiers: UrgencyTier[] = [
  { id: TIER.urgent, slug: 'urgent', name: 'Urgent — I need an answer today', description: 'Goes to the top of the queue.', sort_order: 1, is_active: true, promise_type: 'same_day', promise_hours: null },
  { id: TIER.soon, slug: 'soon', name: 'Fairly soon — within a day or two', description: 'Answered ahead of routine questions.', sort_order: 2, is_active: true, promise_type: 'hours', promise_hours: 48 },
  { id: TIER.standard, slug: 'standard', name: 'No rush — whenever the Rov has time', description: 'Answered in turn, based on the queue.', sort_order: 3, is_active: true, promise_type: 'queue_based', promise_hours: null },
];

export const demoProfiles: Record<string, Profile> = {
  [PROFILE.rov]: { id: PROFILE.rov, role: 'rabbi', full_name: 'Rabbi Yechiel Emanuel', phone: '+447700900001', affiliation: null, organisation: null, is_active: true },
  [PROFILE.dovid]: { id: PROFILE.dovid, role: 'community', full_name: 'Raffi Goldberg', phone: '+447700900123', affiliation: 'shul_member', organisation: null, is_active: true },
  [PROFILE.rivky]: { id: PROFILE.rivky, role: 'community', full_name: 'Mrs Geller', phone: '+447700900456', affiliation: 'shul_member', organisation: null, is_active: true },
  [PROFILE.yosef]: { id: PROFILE.yosef, role: 'community', full_name: 'Anthony Geller', phone: '+447700900789', affiliation: 'mosdos', organisation: 'Jewish High', is_active: true },
};

export function demoProfile(role: DemoRole): Profile {
  return role === 'rabbi' ? demoProfiles[PROFILE.rov] : demoProfiles[PROFILE.dovid];
}

const base = {
  contact_name: null, contact_phone: null, answer: null, answered_at: null,
  ai_suggested_category_id: null, ai_suggested_urgency_id: null, ai_confidence: null,
  triage_confirmed_at: null, handed_off: false,
};

/** The Rov's queue: a same-day private matter, an AI-triaged kashrus question, an SMS caller. */
export const demoQueue: Shailah[] = [
  {
    ...base, id: 'demo-s-1', ref: 'S-0042', profile_id: PROFILE.rivky, channel: 'app',
    category_id: CAT.niddah, urgency_tier_id: TIER.urgent,
    question: 'A taharas hamishpacha question — the full text is only ever shown to the Rov himself.',
    status: 'triaged', due_at: todayAt(22), expected_reply_text: 'The Rov expects to answer later today (by this evening).',
    is_sensitive: true, ai_summary: 'A private matter', triage_confirmed_at: daysAgo(0), created_at: daysAgo(0),
  },
  {
    ...base, id: 'demo-s-2', ref: 'S-0041', profile_id: PROFILE.rivky, channel: 'app',
    category_id: CAT.kashrus, urgency_tier_id: TIER.urgent,
    question: 'I was cooking milchig soup and stirred it with a clean meat spoon by mistake — the soup was boiling at the time. What do I do with the soup, and with the spoon?',
    status: 'new', due_at: todayAt(20), expected_reply_text: 'The Rov expects to answer later today (by this evening).',
    is_sensitive: false, ai_summary: 'Meat spoon used in a boiling milchig soup',
    ai_suggested_category_id: CAT.kashrus, ai_suggested_urgency_id: TIER.urgent, ai_confidence: 0.93,
    created_at: daysAgo(0),
  },
  {
    ...base, id: 'demo-s-3', ref: 'S-0040', profile_id: null, channel: 'sms',
    contact_name: 'Mrs Baila Katz', contact_phone: '+447700900321',
    category_id: CAT.shabbos, urgency_tier_id: TIER.soon,
    question: 'Texted in: can I ask the non-Jewish carer to switch the heating on for my mother on Shabbos?',
    status: 'triaged', due_at: hoursFromNow(30), expected_reply_text: 'The Rov expects to answer by tomorrow evening.',
    is_sensitive: false, ai_summary: 'Amirah l\'akum — heating for an elderly parent', triage_confirmed_at: daysAgo(0),
    created_at: daysAgo(1),
  },
  {
    ...base, id: 'demo-s-4', ref: 'S-0039', profile_id: PROFILE.yosef, channel: 'app',
    category_id: CAT.chinuch, urgency_tier_id: TIER.standard,
    question: 'Our son is struggling in his class and the rebbi has suggested moving him down a year. We are not sure it is the right thing for him. Could we have the Rov\'s view?',
    status: 'new', due_at: hoursFromNow(52), expected_reply_text: 'The Rov expects to answer by Thursday evening.',
    is_sensitive: false, ai_summary: 'Whether to move a struggling boy down a year',
    ai_suggested_category_id: CAT.chinuch, ai_suggested_urgency_id: TIER.standard, ai_confidence: 0.88,
    created_at: daysAgo(2),
  },
];

export const demoAnswered: Shailah[] = [
  {
    ...base, id: 'demo-s-5', ref: 'S-0038', profile_id: PROFILE.dovid, channel: 'app',
    category_id: CAT.kashrus, urgency_tier_id: TIER.soon,
    question: 'We left a fleishig pot to soak overnight in the milchig sink. Both were clean. Is the pot still usable?',
    status: 'answered',
    answer: 'The pot is fine to carry on using — everything was clean and cold, so nothing has transferred. Going forward, keep a separate bowl in the sink for soaking and it avoids the whole question.',
    answered_at: daysAgo(3), due_at: daysAgo(3),
    expected_reply_text: 'The Rov expects to answer by Sunday evening.',
    is_sensitive: false, ai_summary: 'Fleishig pot soaked in the milchig sink', triage_confirmed_at: daysAgo(4),
    created_at: daysAgo(4),
  },
];

/** What Dovid (the sample community member) sees under "my requests". */
export const demoMyShailos: Shailah[] = [
  {
    ...base, id: 'demo-s-6', ref: 'S-0043', profile_id: PROFILE.dovid, channel: 'app',
    category_id: CAT.shabbos, urgency_tier_id: TIER.soon,
    question: 'Our smoke alarm started chirping on Shabbos morning because of a flat battery. Were we allowed to take it down?',
    status: 'triaged', due_at: hoursFromNow(26),
    expected_reply_text: 'The Rov expects to answer by tomorrow evening.',
    is_sensitive: false, ai_summary: 'Chirping smoke alarm on Shabbos', triage_confirmed_at: daysAgo(0),
    created_at: daysAgo(0),
  },
  ...demoAnswered,
];

export const demoBookings: Booking[] = [
  {
    id: 'demo-b-1', ref: 'B-0027', profile_id: PROFILE.dovid, contact_name: null, contact_phone: null,
    slot_type: 'call', starts_at: todayAt(21), ends_at: todayAt(21, 10),
    purpose: null, status: 'confirmed', decline_reason: null, created_at: daysAgo(1),
  },
  {
    id: 'demo-b-2', ref: 'B-0028', profile_id: PROFILE.yosef, contact_name: null, contact_phone: null,
    slot_type: 'meeting', starts_at: nextWeekdayAt(0, 20, 15), ends_at: nextWeekdayAt(0, 20, 45),
    purpose: 'A chinuch matter for our son', status: 'requested', decline_reason: null, created_at: daysAgo(0),
  },
  {
    id: 'demo-b-3', ref: 'B-0026', profile_id: null, contact_name: 'Mrs Baila Katz', contact_phone: '+447700900321',
    slot_type: 'call', starts_at: nextWeekdayAt(0, 19, 15), ends_at: nextWeekdayAt(0, 19, 25),
    purpose: null, status: 'confirmed', decline_reason: null, created_at: daysAgo(2),
  },
];

export const demoTimetable: TimetableBlock[] = [
  { id: 'demo-t-1', weekday: 0, start_time: '08:00', end_time: '09:00', label: 'Shacharis', block_type: 'davening', is_active: true },
  { id: 'demo-t-2', weekday: 1, start_time: '07:00', end_time: '08:00', label: 'Shacharis', block_type: 'davening', is_active: true },
  { id: 'demo-t-3', weekday: 1, start_time: '09:00', end_time: '13:00', label: 'Beis Hatalmud', block_type: 'school', is_active: true },
  { id: 'demo-t-4', weekday: 1, start_time: '20:30', end_time: '21:30', label: 'Chosson lesson', block_type: 'chosson', is_active: true },
  { id: 'demo-t-5', weekday: 2, start_time: '07:00', end_time: '08:00', label: 'Shacharis', block_type: 'davening', is_active: true },
  { id: 'demo-t-6', weekday: 2, start_time: '09:00', end_time: '13:00', label: 'Beis Hatalmud', block_type: 'school', is_active: true },
  { id: 'demo-t-7', weekday: 3, start_time: '07:00', end_time: '08:00', label: 'Shacharis', block_type: 'davening', is_active: true },
  { id: 'demo-t-8', weekday: 3, start_time: '09:00', end_time: '13:00', label: 'Beis Hatalmud', block_type: 'school', is_active: true },
  { id: 'demo-t-9', weekday: 3, start_time: '21:00', end_time: '22:00', label: 'Shiur — Daf Yomi', block_type: 'shiur', is_active: true },
  { id: 'demo-t-10', weekday: 4, start_time: '07:00', end_time: '08:00', label: 'Shacharis', block_type: 'davening', is_active: true },
  { id: 'demo-t-11', weekday: 4, start_time: '09:00', end_time: '13:00', label: 'Beis Hatalmud', block_type: 'school', is_active: true },
  { id: 'demo-t-12', weekday: 5, start_time: '07:00', end_time: '08:00', label: 'Shacharis', block_type: 'davening', is_active: true },
  { id: 'demo-t-13', weekday: 5, start_time: '17:00', end_time: '19:00', label: 'Family time', block_type: 'family', is_active: true },
];

/** The weekly pattern — what he keeps every week without touching it again. */
export const demoAvailability: Availability[] = [
  { id: 'demo-a-1', slot_type: 'call', weekday: 0, start_time: '19:00', end_time: '20:00', duration_minutes: 10, location: null, is_active: true },
  { id: 'demo-a-2', slot_type: 'call', weekday: 3, start_time: '21:00', end_time: '21:30', duration_minutes: 10, location: null, is_active: true },
  { id: 'demo-a-3', slot_type: 'meeting', weekday: 2, start_time: '20:00', end_time: '21:30', duration_minutes: 30, location: 'Shul office', is_active: true },
];

export const demoTimeOff: TimeOff[] = [];

export const demoSlotReleases: SlotRelease[] = [
  { id: 'demo-r-1', slot_type: 'call', starts_at: nextWeekdayAt(0, 19, 0), ends_at: nextWeekdayAt(0, 20, 0), duration_minutes: 10, location: null, status: 'open' },
  { id: 'demo-r-2', slot_type: 'meeting', starts_at: nextWeekdayAt(2, 20, 0), ends_at: nextWeekdayAt(2, 21, 30), duration_minutes: 30, location: 'Shul office', status: 'open' },
];

/**
 * Bookable slots offered to a community member — expanded from the weekly pattern the same way
 * the server does it, so preview shows what the kehillah would really be offered.
 */
export function demoSlots(slotType: 'call' | 'meeting') {
  const out: { releaseId: string; slotType: 'call' | 'meeting'; startsAt: string; endsAt: string; location: string | null }[] = [];
  for (const a of demoAvailability.filter((x) => x.slot_type === slotType)) {
    const [sh, sm] = a.start_time.split(':').map(Number);
    const [eh, em] = a.end_time.split(':').map(Number);
    const dur = a.duration_minutes * 60_000;
    // The next two occurrences of that weekday, so there is more than one day to choose from.
    for (let week = 0; week < 2; week++) {
      const start = new Date(nextWeekdayAt(a.weekday, sh, sm));
      start.setDate(start.getDate() + week * 7);
      const end = new Date(start); end.setHours(eh, em, 0, 0);
      for (let t = start.getTime(); t + dur <= end.getTime(); t += dur) {
        out.push({
          releaseId: `weekly:${a.id}`, slotType,
          startsAt: new Date(t).toISOString(), endsAt: new Date(t + dur).toISOString(),
          location: a.location,
        });
      }
    }
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 12);
}

export const demoSettings: Settings = {
  id: 1, timezone: 'Europe/London', daily_shailah_capacity: 10,
  same_day_cutoff_hour: 15, same_day_promise_hour: 22,
  calls_auto_confirm: true, meetings_auto_confirm: false,
  sms_notifications_enabled: true, briefing_enabled: true, rabbi_phone: '+447700900001',
};

export const demoBriefing =
  'Boker tov, Rebbe.\n\n' +
  'Schedule: Shacharis 7:00, Beis Hatalmud until 13:00, chosson lesson 20:30.\n' +
  'Appointments: one phone call this evening, and a meeting request from Yosef Brodie waiting on you.\n' +
  'Questions: four due today, one of them a private matter. Nothing overdue.';

export const demoHandedOff = [
  { id: 'demo-c-1', phone: '+447700900654', updated_at: hoursFromNow(-2) },
];

/** Invitations to speak — the Rov answers every one himself. */
export const demoInvitations: Invitation[] = [
  {
    id: 'demo-i-1', ref: 'I-0007', profile_id: PROFILE.dovid,
    contact_name: null, contact_phone: null, channel: 'app',
    occasion: 'sheva_brochos',
    starts_at: nextWeekdayAt(0, 21, 0), duration_minutes: 20,
    location: 'Simcha hall, 14 Cheltenham Cres',
    notes: 'Sheva brochos for my daughter.',
    expected_attendance: 60,
    status: 'requested', decline_reason: null, responded_at: null, created_at: daysAgo(1),
  },
  {
    id: 'demo-i-2', ref: 'I-0006', profile_id: null,
    contact_name: 'Anthony Geller', contact_phone: '+447700900789', channel: 'sms',
    occasion: 'bar_mitzvah',
    starts_at: nextWeekdayAt(0, 12, 30), duration_minutes: 10,
    location: 'Hertsmere hall', notes: 'Booked over text — ten minutes is plenty.',
    expected_attendance: null,
    status: 'accepted', decline_reason: null, responded_at: daysAgo(0), created_at: daysAgo(3),
  },
];
