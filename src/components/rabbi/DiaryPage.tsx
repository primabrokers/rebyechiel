import { useEffect, useState } from 'react';
import { addDays, format, startOfWeek } from 'date-fns';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { isDemo } from '../../lib/demo';
import {
  fetchAvailability, fetchCalendar, fetchProfilesByIds, fetchSlotReleases, fetchTimeOff,
  fetchTimetable, fetchUpcomingBookings,
} from '../../lib/rabbiData';
import type {
  Availability, Booking, CalendarDay, Profile, SlotRelease, TimeOff, TimetableBlock,
} from '../../types';
import { ZMANIM_SHOWN, slotsInWindow } from '../../types';
import { Btn, Field, Panel, Portal, Spinner, Toast, inputCls } from '../shared/ui';
import { whoOf } from '../../lib/present';
import { OpenTimesSheet } from './OpenTimesSheet';

/**
 * The week at a glance. Grey is his fixed week — nothing can be booked over it. Indigo is
 * someone who booked him. Sunday to Friday only: nothing is ever placed on Shabbos.
 */
const DAY_START = 7;   // grid starts at 07:00
const DAY_END = 22;    // and ends at 22:00
const ROW_H = 38;      // pixels per hour
const HOURS = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);

const BLOCK_TYPES = [
  { key: 'davening', label: 'Davening' },
  { key: 'shiur', label: 'Shiur' },
  { key: 'school', label: 'School' },
  { key: 'chosson', label: 'Chosson lesson' },
  { key: 'family', label: 'Family time' },
  { key: 'other', label: 'Other' },
] as const;

const minutesFrom = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h - DAY_START) * 60 + m;
};
const toPx = (min: number) => (min / 60) * ROW_H;

export function DiaryPage() {
  const [loading, setLoading] = useState(true);
  const [blocks, setBlocks] = useState<TimetableBlock[]>([]);
  const [releases, setReleases] = useState<SlotRelease[]>([]);
  const [weekly, setWeekly] = useState<Availability[]>([]);
  const [daysOff, setDaysOff] = useState<TimeOff[]>([]);
  const [calendar, setCalendar] = useState<Map<string, CalendarDay>>(new Map());
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [sheet, setSheet] = useState<null | 'release' | 'block'>(null);
  const [toast, setToast] = useState<string | null>(null);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3200); };

  const load = async () => {
    const week = startOfWeek(new Date(), { weekStartsOn: 0 });
    const [t, r, b, a, o, c] = await Promise.all([
      fetchTimetable(), fetchSlotReleases(), fetchUpcomingBookings(14), fetchAvailability(), fetchTimeOff(),
      fetchCalendar(format(week, 'yyyy-MM-dd'), format(addDays(week, 6), 'yyyy-MM-dd')),
    ]);
    setBlocks(t); setReleases(r); setBookings(b); setWeekly(a); setDaysOff(o); setCalendar(c);
    setProfiles(await fetchProfilesByIds(b.map((x) => x.profile_id).filter(Boolean) as string[]));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  if (loading) return <Spinner />;

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 0 }); // Sunday
  const days = Array.from({ length: 6 }, (_, i) => addDays(weekStart, i)); // Sun–Fri
  const today = new Date().getDay();

  const remove = async (table: 'rabbi_timetable_blocks' | 'rabbi_slot_releases', id: string) => {
    if (isDemo()) return;
    await supabase.from(table)
      .update(table === 'rabbi_slot_releases' ? { status: 'closed' } : { is_active: false })
      .eq('id', id);
    await load();
    say(table === 'rabbi_slot_releases' ? 'Those times are closed.' : 'Taken off your week.');
  };

  const stopWeekly = async (a: Availability) => {
    if (!isDemo()) await supabase.from('rabbi_availability').update({ is_active: false }).eq('id', a.id);
    await load();
    say(`Stopped. Nothing new can be booked on a ${WEEKDAYS[a.weekday]}${weekly.length > 1 ? ' at that time' : ''}.`);
  };

  const comeBack = async (o: TimeOff) => {
    if (!isDemo()) await supabase.from('rabbi_time_off').delete().eq('id', o.id);
    await load();
    say('Back on — your weekly times run that day again.');
  };

  return (
    <div className="flex flex-col gap-4 animate-fadeUp max-w-[1320px]">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[13px] text-ink-muted">
          Grey is your fixed week. Dashed indigo is open to book. Solid indigo is someone who booked you.
          Shabbos and yom tov are shaded — nothing is ever offered on them, or promised for them.
        </span>
        <div className="ml-auto flex gap-2">
          <Btn onClick={() => setSheet('block')}>Add to my week</Btn>
          <Btn tone="indigo" onClick={() => setSheet('release')}>Open times</Btn>
        </div>
      </div>

      <WeeklyTimes weekly={weekly} daysOff={daysOff} releases={releases}
        onStop={stopWeekly} onComeBack={comeBack} onAdd={() => setSheet('release')} />

      <Zmanim day={calendar.get(format(new Date(), 'yyyy-MM-dd'))} />

      <Panel className="overflow-hidden">
        <div className="grid grid-cols-[62px_repeat(6,1fr)] border-b">
          <div />
          {days.map((d) => {
            const cal = calendar.get(format(d, 'yyyy-MM-dd'));
            return (
              <div key={d.toISOString()} className="py-3 px-2.5 text-center border-l border-hair">
                <div className={clsx('text-[12.5px] font-extrabold', d.getDay() === today ? 'text-indigo' : 'text-ink')}>
                  {format(d, 'EEE')}
                </div>
                <div className="font-mono text-[11px] font-medium text-ink-faint">{format(d, 'd')}</div>
                {cal?.label && (
                  <div className={clsx('mt-1 text-[10.5px] font-bold leading-tight truncate',
                    cal.no_work ? 'text-warn' : 'text-ink-muted')} title={cal.label}>
                    {cal.label}
                  </div>
                )}
                {cal?.candles_at && (
                  <div className="font-mono text-[10px] text-warn" title="Candle lighting">
                    ✦ {format(new Date(cal.candles_at), 'HH:mm')}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="relative grid grid-cols-[62px_repeat(6,1fr)] overflow-x-auto"
          style={{ height: (DAY_END - DAY_START) * ROW_H }}>
          <div className="flex flex-col">
            {HOURS.map((h) => (
              <div key={h} style={{ height: ROW_H }}
                className="pr-2.5 text-right font-mono text-[10.5px] font-medium text-ink-faint border-t border-hair">
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {days.map((d) => {
            const wd = d.getDay();
            const dayBlocks = blocks.filter((b) => b.weekday === wd);
            const dayReleases = releases.filter((r) => r.status === 'open' && new Date(r.starts_at).getDay() === wd);
            const dayBookings = bookings.filter((b) => new Date(b.starts_at).toDateString() === d.toDateString());
            const cal = calendar.get(format(d, 'yyyy-MM-dd'));
            const rest = Boolean(cal?.no_work);
            return (
              <div key={d.toISOString()}
                className={clsx('relative border-l border-hair',
                  rest ? 'bg-warn-bg/50' : wd === today ? 'bg-subtle' : 'bg-surface')}>
                {HOURS.map((h) => <div key={h} style={{ height: ROW_H }} className="border-t border-hair" />)}

                {dayBlocks.map((b) => (
                  <Event key={b.id} top={toPx(minutesFrom(b.start_time))}
                    height={toPx(minutesFrom(b.end_time) - minutesFrom(b.start_time))}
                    label={b.label} time={`${b.start_time.slice(0, 5)}–${b.end_time.slice(0, 5)}`}
                    onRemove={() => remove('rabbi_timetable_blocks', b.id)} />
                ))}
                {!rest && weekly.filter((a) => a.weekday === wd).map((a) => (
                  <Event key={a.id} variant="open" top={toPx(minutesFrom(a.start_time.slice(0, 5)))}
                    height={toPx(minutesFrom(a.end_time.slice(0, 5)) - minutesFrom(a.start_time.slice(0, 5)))}
                    label={`${slotsInWindow(a)} ${a.slot_type === 'call' ? 'calls' : 'meetings'} open`}
                    time={`every week · ${a.duration_minutes}m each`} />
                ))}
                {!rest && dayReleases.map((r) => (
                  <Event key={r.id} variant="open" top={toPx(minutesFrom(format(new Date(r.starts_at), 'HH:mm')))}
                    height={toPx((Date.parse(r.ends_at) - Date.parse(r.starts_at)) / 60000)}
                    label={r.slot_type === 'call' ? 'Extra calls' : 'Extra meetings'}
                    time={`${format(new Date(r.starts_at), 'HH:mm')} · ${r.duration_minutes}m each`}
                    onRemove={() => remove('rabbi_slot_releases', r.id)} />
                ))}
                {dayBookings.map((b) => (
                  <Event key={b.id} variant="booked" top={toPx(minutesFrom(format(new Date(b.starts_at), 'HH:mm')))}
                    height={toPx((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000)}
                    label={whoOf(b, profiles)}
                    time={`${format(new Date(b.starts_at), 'HH:mm')} ${b.slot_type}`} />
                ))}
              </div>
            );
          })}
        </div>
      </Panel>

      {sheet === 'release' && (
        <OpenTimesSheet onClose={() => setSheet(null)}
          onSaved={async (m) => { setSheet(null); await load(); say(m); }} />
      )}
      {sheet === 'block' && (
        <Sheet kind="block" onClose={() => setSheet(null)}
          onSaved={async (m) => { setSheet(null); await load(); say(m); }} />
      )}
      {toast && <Toast message={toast} />}
    </div>
  );
}

function Event({ top, height, label, time, variant = 'fixed', onRemove }: {
  top: number; height: number; label: string; time: string;
  variant?: 'fixed' | 'open' | 'booked'; onRemove?: () => void;
}) {
  const indigo = variant !== 'fixed';
  return (
    <div
      className={clsx('absolute left-[5px] right-[5px] rounded-ctl px-2 py-1.5 overflow-hidden group border-l-[3px]',
        variant === 'booked' ? 'bg-indigo-tint border-l-indigo'
          : variant === 'open' ? 'bg-indigo-softer border border-dashed border-indigo/40 border-l-[3px] border-l-indigo/60'
            : 'bg-[#f2f3f5] border-l-ink-ghost')}
      style={{ top, height: Math.max(height, 22) }}
    >
      <div className={clsx('text-[11.5px] font-extrabold leading-tight truncate', indigo ? 'text-indigo-ink' : 'text-ink-soft')}>{label}</div>
      <div className={clsx('font-mono text-[10px] font-medium truncate', indigo ? 'text-indigo-mid' : 'text-ink-faint')}>{time}</div>
      {onRemove && (
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={`Remove ${label}`}
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-ink-muted hover:text-ink">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

/**
 * Today's zmanim, from Hebcal for the configured place. A quiet strip rather than a panel: he
 * glances at it, he does not work from it, and it must never compete with what needs him.
 */
function Zmanim({ day }: { day?: CalendarDay }) {
  if (!day?.zmanim) return null;
  const times = ZMANIM_SHOWN.filter((z) => day.zmanim?.[z.key]);
  if (!times.length) return null;
  return (
    <Panel className="px-5 py-3.5 flex items-center gap-x-5 gap-y-2 flex-wrap">
      <span className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-ink-muted flex-none">
        Zmanim today{day.hebrew_date ? ` · ${day.hebrew_date}` : ''}
      </span>
      {times.map((z) => (
        <span key={z.key} className="flex items-baseline gap-1.5">
          <span className="text-[11.5px] text-ink-muted">{z.label}</span>
          <span className="font-mono text-[12px] font-semibold">{format(new Date(day.zmanim![z.key]), 'HH:mm')}</span>
        </span>
      ))}
      {day.candles_at && (
        <span className="flex items-baseline gap-1.5 text-warn">
          <span className="text-[11.5px] font-bold">✦ Candles</span>
          <span className="font-mono text-[12px] font-bold">{format(new Date(day.candles_at), 'HH:mm')}</span>
        </span>
      )}
    </Panel>
  );
}

/**
 * The times he keeps every week, in plain sentences with the count that matters — this is what
 * he sets, and the grid below is only the consequence of it. One-off extras and days he's away
 * sit alongside, so everything affecting what the kehillah can book is in one place.
 */
function WeeklyTimes({ weekly, daysOff, releases, onStop, onComeBack, onAdd }: {
  weekly: Availability[];
  daysOff: TimeOff[];
  releases: SlotRelease[];
  onStop: (a: Availability) => void;
  onComeBack: (o: TimeOff) => void;
  onAdd: () => void;
}) {
  const extras = releases.filter((r) => r.status === 'open' && Date.parse(r.ends_at) > Date.now());
  const perWeek = weekly.reduce((n, a) => n + slotsInWindow(a), 0);

  return (
    <Panel className="p-5 flex flex-col gap-3.5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-[15px] font-extrabold tracking-tight">Times you keep every week</span>
        <span className="text-[12.5px] text-ink-muted">
          {perWeek > 0
            ? `Set once — that's ${perWeek} ${perWeek === 1 ? 'person' : 'people'} a week, without you doing anything again.`
            : 'Nothing is open yet, so nobody can book you.'}
        </span>
        <Btn className="ml-auto" onClick={onAdd}>Add a time</Btn>
      </div>

      {weekly.length === 0 ? (
        <div className="rounded-md border border-dashed border-strong px-4 py-5 text-center">
          <span className="text-[13.5px] text-ink-muted">
            Open an evening a week and the kehillah can book it from now on.
          </span>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {weekly.map((a) => (
            <div key={a.id} className="group rounded-md border bg-canvas px-3.5 py-3 flex items-start gap-2">
              <span className={clsx('mt-[5px] w-[7px] h-[7px] rounded-pill flex-none',
                a.slot_type === 'call' ? 'bg-indigo' : 'bg-good')} />
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="text-[13.5px] font-bold">
                  Every {WEEKDAYS[a.weekday]} · {slotsInWindow(a)} {a.slot_type === 'call' ? 'calls' : 'meetings'}
                </span>
                <span className="font-mono text-[11.5px] text-ink-muted">
                  {a.start_time.slice(0, 5)}–{a.end_time.slice(0, 5)} · {a.duration_minutes}m each
                  {a.location ? ` · ${a.location}` : ''}
                </span>
              </div>
              <button onClick={() => onStop(a)} aria-label={`Stop ${WEEKDAYS[a.weekday]} times`}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-ink-muted hover:text-late flex-none">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {(extras.length > 0 || daysOff.length > 0) && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {extras.map((r) => (
            <span key={r.id} className="rounded-chip bg-indigo-soft px-2.5 py-1.5 text-[11.5px] font-semibold text-indigo-ink">
              Extra {r.slot_type === 'call' ? 'calls' : 'meetings'} {format(new Date(r.starts_at), 'EEE d MMM')}
            </span>
          ))}
          {daysOff.map((o) => (
            <button key={o.id} onClick={() => onComeBack(o)}
              className="rounded-chip bg-warn-bg px-2.5 py-1.5 text-[11.5px] font-semibold text-warn hover:bg-warn/20 transition-colors">
              Away {format(new Date(`${o.on_date}T12:00:00`), 'EEE d MMM')}{o.reason ? ` · ${o.reason}` : ''} ✕
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

/** His fixed week — davening, shiurim, school, chosson lessons. Nothing can be booked over it. */
function Sheet({ kind, onClose, onSaved }: { kind: 'block'; onClose: () => void; onSaved: (m: string) => void }) {
  const [from, setFrom] = useState('19:00');
  const [to, setTo] = useState('20:00');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [label, setLabel] = useState('');
  const [blockType, setBlockType] = useState<TimetableBlock['block_type']>('davening');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setError(null);
    if (to <= from) { setError('The end time must be after the start.'); setBusy(false); return; }
    if (isDemo()) { setBusy(false); onSaved('Saved.'); return; }

    if (!weekdays.length) { setError('Pick at least one day.'); setBusy(false); return; }
    const { error: err } = await supabase.from('rabbi_timetable_blocks').insert(
      weekdays.map((weekday) => ({
        weekday, start_time: from, end_time: to,
        label: label.trim() || BLOCK_TYPES.find((b) => b.key === blockType)!.label,
        block_type: blockType,
      })),
    );
    setBusy(false);
    if (err) { setError(err.message); return; }
    onSaved('Added to your week — nothing can be booked over it.');
  };

  return (
    <Portal>
      <div onClick={onClose} className="fixed inset-0 z-40 bg-graphite-deep/40" />
      <aside className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[440px] bg-surface flex flex-col shadow-drawer animate-slideIn">
        <header className="px-6 py-5 border-b flex items-center">
          <span className="text-[17px] font-extrabold tracking-tight flex-1">Add to my week</span>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-ctl grid place-items-center text-ink-muted hover:bg-canvas">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-4">
              <Field label="What is it?">
                <div className="grid grid-cols-3 gap-2">
                  {BLOCK_TYPES.map((b) => (
                    <button key={b.key} onClick={() => setBlockType(b.key)}
                      className={clsx('rounded-ctl py-2.5 px-1 text-[12.5px] font-bold border',
                        blockType === b.key ? 'bg-graphite text-white border-graphite' : 'bg-canvas text-ink-soft')}>
                      {b.label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Name it (optional)">
                <input className={inputCls} placeholder="e.g. Shacharis, Beis Hatalmud" value={label} onChange={(e) => setLabel(e.target.value)} />
              </Field>
              <Field label="Which days?">
                <div className="flex gap-1.5 flex-wrap">
                  {WEEKDAYS.map((d, i) => (
                    <button key={d} onClick={() => setWeekdays((w) => w.includes(i) ? w.filter((x) => x !== i) : [...w, i])}
                      className={clsx('rounded-pill px-3.5 py-2 text-[12.5px] font-extrabold border',
                        weekdays.includes(i) ? 'bg-graphite text-white border-graphite' : 'bg-canvas text-ink-soft')}>
                      {d.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From"><input type="time" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                <Field label="Until"><input type="time" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              </div>
          {error && <p className="text-[12.5px] font-bold text-late">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t">
          <Btn tone="dark" busy={busy} className="w-full py-3.5 text-[14.5px]" onClick={save}>
            Add to my week
          </Btn>
        </footer>
      </aside>
    </Portal>
  );
}
