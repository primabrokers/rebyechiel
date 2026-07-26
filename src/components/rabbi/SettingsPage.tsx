import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { supabase } from '../../lib/supabase';
import { isDemo } from '../../lib/demo';
import { fetchCategories, fetchProfilesByIds, fetchSettings } from '../../lib/rabbiData';
import type { Category, Settings } from '../../types';
import { Btn, Field, Panel, Spinner, Toast, Toggle, inputCls } from '../shared/ui';
import { format } from 'date-fns';
import { useAuth } from '../../lib/auth';
import { ConnectionsPanel } from './ConnectionsPanel';

/**
 * Plain switches in plain words. Every change saves itself and says so — there is no Save button
 * to forget, and nothing here can lose a question.
 */
/**
 * The places this kehillah is likely to need. Each is a Hebcal geonameid — anywhere else can be
 * added here, or set directly in rabbi_settings if the Rov ever moves somewhere unlisted.
 */
const PLACES = [
  { name: 'Manchester, United Kingdom', geonameid: 2643123, lat: 53.48102, lon: -2.23679, israel: false },
  { name: 'London, United Kingdom', geonameid: 2643743, lat: 51.50853, lon: -0.12574, israel: false },
  { name: 'Gateshead, United Kingdom', geonameid: 2648579, lat: 54.96209, lon: -1.60168, israel: false },
  { name: 'Jerusalem, Israel', geonameid: 281184, lat: 31.76904, lon: 35.21633, israel: true },
];

export function SettingsPage() {
  const { profile, signOut } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [helpers, setHelpers] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  useEffect(() => {
    Promise.all([fetchSettings(), fetchCategories(true)]).then(([s, c]) => { setSettings(s); setCats(c); });
    // Who else can get in — shown so he can see at a glance that no helper reads private shailos.
    if (!isDemo()) {
      supabase.from('rabbi_profiles').select('full_name').eq('role', 'assistant').eq('is_active', true)
        .then(({ data }) => setHelpers((data ?? []).map((r) => r.full_name as string)));
    }
  }, []);

  if (!settings) return <Spinner />;

  const patch = async (fields: Partial<Settings>, message: string) => {
    setSettings({ ...settings, ...fields });
    if (!isDemo()) {
      await supabase.from('rabbi_settings').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', 1);
    }
    say(message);
  };

  const toggleCategory = async (c: Category) => {
    setCats(cats.map((x) => x.id === c.id ? { ...x, is_active: !c.is_active } : x));
    if (!isDemo()) await supabase.from('rabbi_categories').update({ is_active: !c.is_active }).eq('id', c.id);
    say(c.is_active === false ? `${c.name} is back on the list.` : `${c.name} is off the list — nothing already asked is lost.`);
  };

  /** Changing the place re-fetches the whole calendar, so it can never disagree with itself. */
  const setPlace = async (pl: typeof PLACES[number]) => {
    await patch({
      location_name: pl.name, location_geonameid: pl.geonameid,
      location_latitude: pl.lat, location_longitude: pl.lon, in_israel: pl.israel,
    }, `Now working to ${pl.name}. Fetching the calendar…`);
    await syncCalendar();
  };

  const syncCalendar = async () => {
    if (isDemo()) { say('Calendar refreshed.'); return; }
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('rabbi-calendar');
      if (error || data?.error) { say("Couldn't reach the calendar service — it will try again tonight."); return; }
      setSettings((s) => (s ? { ...s, calendar_synced_at: new Date().toISOString() } : s));
      say(`Calendar updated — ${data?.days ?? 0} days for ${data?.location ?? 'your area'}.`);
    } finally { setSyncing(false); }
  };

  const toggles: { key: keyof Settings; label: string; hint: string }[] = [
    { key: 'calls_auto_confirm', label: 'Phone calls book themselves',
      hint: 'Someone picks a time you released and it is simply booked. Turn off to approve each one.' },
    { key: 'meetings_auto_confirm', label: 'Meetings book themselves',
      hint: 'Most Rabbonim leave this off so nothing lands in the diary without them.' },
    { key: 'briefing_enabled', label: 'Morning briefing',
      hint: 'A short text each morning with your day and anything overdue.' },
    { key: 'sms_notifications_enabled', label: 'Texts to the kehillah',
      hint: "Booking confirmations, reminders, and 'your answer is ready'." },
  ];

  return (
    <div className="flex flex-col gap-4 animate-fadeUp max-w-[760px]">
      <span className="text-[13px] text-ink-muted">Everything here saves itself. Nothing you change can lose a question.</span>

      <Panel className="p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[15px] font-extrabold tracking-tight">How many questions can you answer in a day?</span>
          <span className="text-[12.5px] leading-snug text-ink-muted">
            This is what decides the “expect an answer by…” each person is promised. Ten means roughly two days' wait when the queue is full.
          </span>
        </div>
        <div className="flex gap-2">
          {[5, 10, 15, 20].map((n) => (
            <button key={n}
              onClick={() => patch({ daily_shailah_capacity: n }, `Saved — new questions will be promised on ${n} a day.`)}
              className={clsx('flex-1 rounded-md py-3.5 text-[16px] font-extrabold border transition-colors',
                settings.daily_shailah_capacity === n ? 'bg-graphite text-white border-graphite' : 'bg-canvas text-ink-soft')}>
              {n}
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="px-5 py-1">
        {toggles.map((t) => (
          <div key={t.key} className="flex items-center gap-4 py-4 border-b border-hair last:border-b-0">
            <div className="flex-1 flex flex-col gap-0.5">
              <span className="text-[14px] font-bold">{t.label}</span>
              <span className="text-[12.5px] leading-snug text-ink-muted">{t.hint}</span>
            </div>
            <Toggle
              label={t.label}
              on={Boolean(settings[t.key])}
              onFlip={() => patch({ [t.key]: !settings[t.key] } as Partial<Settings>, 'Saved.')}
            />
          </div>
        ))}
      </Panel>

      <Panel className="p-5 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[15px] font-extrabold tracking-tight">Who can see private questions</span>
          <span className="text-[12.5px] leading-snug text-ink-muted">
            Niddah and shalom bayis are hidden from everyone but you — in lists, in texts, and in the database itself.
          </span>
        </div>
        <div className="flex gap-2.5 flex-wrap">
          <span className="rounded-ctl bg-graphite px-3.5 py-2.5 text-[13px] font-bold text-white">
            {profile?.full_name ?? 'You'} · you
          </span>
          {helpers.map((h) => (
            <span key={h} className="rounded-ctl bg-canvas border px-3.5 py-2.5 text-[13px] text-ink-soft">{h} (helper) · never</span>
          ))}
          {helpers.length === 0 && (
            <span className="rounded-ctl border border-dashed border-strong px-3.5 py-2.5 text-[13px] text-ink-muted">
              No helper accounts yet
            </span>
          )}
        </div>
      </Panel>

      <Panel className="p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[15px] font-extrabold tracking-tight">Where you are</span>
          <span className="text-[12.5px] leading-snug text-ink-muted">
            Candle-lighting, yom tov and the zmanim are worked out for this place. Change it and the
            calendar is fetched again straight away.
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {PLACES.map((pl) => (
            <button key={pl.geonameid}
              onClick={() => setPlace(pl)}
              className={clsx('rounded-md px-3.5 py-3 text-left border-[1.5px] transition-colors flex items-center gap-3',
                settings.location_geonameid === pl.geonameid ? 'border-graphite bg-subtle' : 'border-[rgba(16,19,24,.11)] bg-surface')}>
              <div className="flex-1 flex flex-col gap-px">
                <span className="text-[14px] font-extrabold">{pl.name}</span>
                <span className="font-mono text-[11px] text-ink-muted">
                  {pl.lat.toFixed(3)}, {pl.lon.toFixed(3)}{pl.israel ? ' · one day yom tov' : ''}
                </span>
              </div>
              {settings.location_geonameid === pl.geonameid && <span className="text-[15px] font-extrabold">✓</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[12px] text-ink-muted">
            {settings.calendar_synced_at
              ? `Calendar last fetched ${format(new Date(settings.calendar_synced_at), 'd MMM, HH:mm')}.`
              : 'The calendar has not been fetched yet.'}
          </span>
          <Btn className="ml-auto" busy={syncing} onClick={syncCalendar}>Fetch it again</Btn>
        </div>
      </Panel>

      <Panel className="p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[15px] font-extrabold tracking-tight">Where we reach you</span>
          <span className="text-[12.5px] leading-snug text-ink-muted">For the morning briefing and reminders before an appointment.</span>
        </div>
        <Field label="Your mobile number">
          <input className={inputCls} type="tel" defaultValue={settings.rabbi_phone ?? ''} placeholder="07123 456789"
            onBlur={(e) => patch({ rabbi_phone: e.target.value.trim() || null }, 'Saved.')} />
        </Field>
      </Panel>

      {profile?.role === 'rabbi' && (
        <ConnectionsPanel rabbiPhone={settings.rabbi_phone} say={say} />
      )}

      <Panel className="px-5 py-1">
        <div className="py-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[15px] font-extrabold tracking-tight">What people can ask about</span>
            <span className="text-[12.5px] leading-snug text-ink-muted">
              Turning one off hides it from the kehillah's list. Questions already asked stay exactly where they are.
            </span>
          </div>
          {cats.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-1">
              <div className="flex-1 flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-bold">{c.name}</span>
                {c.is_sensitive && <span className="text-[11.5px] font-bold text-indigo">private</span>}
                {c.default_same_day && <span className="text-[11.5px] font-bold text-late">same day</span>}
              </div>
              <Toggle label={c.name} on={c.is_active !== false} onFlip={() => toggleCategory(c)} />
            </div>
          ))}
        </div>
      </Panel>

      <div className="flex items-center gap-3 pb-4">
        <span className="text-[12.5px] text-ink-muted">
          Signed in as {profile?.full_name} · {profile?.role === 'rabbi' ? 'the Rov' : 'helper'}
        </span>
        <Btn className="ml-auto" onClick={signOut}>Sign out</Btn>
      </div>

      {toast && <Toast message={toast} />}
    </div>
  );
}
