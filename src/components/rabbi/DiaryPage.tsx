import { useEffect, useState } from 'react';
import { addDays, format, startOfWeek } from 'date-fns';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { isDemo } from '../../lib/demo';
import {
  fetchProfilesByIds, fetchSlotReleases, fetchTimetable, fetchUpcomingBookings,
} from '../../lib/rabbiData';
import type { Booking, Profile, SlotRelease, TimetableBlock } from '../../types';
import { Btn, Field, Panel, Portal, Spinner, Toast, inputCls } from '../shared/ui';
import { whoOf } from '../../lib/present';

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
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [sheet, setSheet] = useState<null | 'release' | 'block'>(null);
  const [toast, setToast] = useState<string | null>(null);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3200); };

  const load = async () => {
    const [t, r, b] = await Promise.all([fetchTimetable(), fetchSlotReleases(), fetchUpcomingBookings(14)]);
    setBlocks(t); setReleases(r); setBookings(b);
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

  return (
    <div className="flex flex-col gap-4 animate-fadeUp max-w-[1320px]">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[13px] text-ink-muted">
          Grey is your fixed week. Indigo is someone who booked you. Shabbos is never shown — nothing is ever placed on it.
        </span>
        <div className="ml-auto flex gap-2">
          <Btn onClick={() => setSheet('block')}>Add to my week</Btn>
          <Btn tone="indigo" onClick={() => setSheet('release')}>Release call times</Btn>
        </div>
      </div>

      <Panel className="overflow-hidden">
        <div className="grid grid-cols-[62px_repeat(6,1fr)] border-b">
          <div />
          {days.map((d) => (
            <div key={d.toISOString()} className="py-3 px-2.5 text-center border-l border-hair">
              <div className={clsx('text-[12.5px] font-extrabold', d.getDay() === today ? 'text-indigo' : 'text-ink')}>
                {format(d, 'EEE')}
              </div>
              <div className="font-mono text-[11px] font-medium text-ink-faint">{format(d, 'd')}</div>
            </div>
          ))}
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
            return (
              <div key={d.toISOString()}
                className={clsx('relative border-l border-hair', wd === today ? 'bg-subtle' : 'bg-surface')}>
                {HOURS.map((h) => <div key={h} style={{ height: ROW_H }} className="border-t border-hair" />)}

                {dayBlocks.map((b) => (
                  <Event key={b.id} top={toPx(minutesFrom(b.start_time))}
                    height={toPx(minutesFrom(b.end_time) - minutesFrom(b.start_time))}
                    label={b.label} time={`${b.start_time.slice(0, 5)}–${b.end_time.slice(0, 5)}`}
                    onRemove={() => remove('rabbi_timetable_blocks', b.id)} />
                ))}
                {dayReleases.map((r) => (
                  <Event key={r.id} booked top={toPx(minutesFrom(format(new Date(r.starts_at), 'HH:mm')))}
                    height={toPx((Date.parse(r.ends_at) - Date.parse(r.starts_at)) / 60000)}
                    label={r.slot_type === 'call' ? 'Calls open' : 'Meetings open'}
                    time={`${format(new Date(r.starts_at), 'HH:mm')} · ${r.duration_minutes}m each`}
                    onRemove={() => remove('rabbi_slot_releases', r.id)} />
                ))}
                {dayBookings.map((b) => (
                  <Event key={b.id} booked top={toPx(minutesFrom(format(new Date(b.starts_at), 'HH:mm')))}
                    height={toPx((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000)}
                    label={whoOf(b, profiles)}
                    time={`${format(new Date(b.starts_at), 'HH:mm')} ${b.slot_type}`} />
                ))}
              </div>
            );
          })}
        </div>
      </Panel>

      {sheet && <Sheet kind={sheet} onClose={() => setSheet(null)} onSaved={async (m) => { setSheet(null); await load(); say(m); }} />}
      {toast && <Toast message={toast} />}
    </div>
  );
}

function Event({ top, height, label, time, booked, onRemove }: {
  top: number; height: number; label: string; time: string; booked?: boolean; onRemove?: () => void;
}) {
  return (
    <div
      className={clsx('absolute left-[5px] right-[5px] rounded-ctl px-2 py-1.5 overflow-hidden group border-l-[3px]',
        booked ? 'bg-indigo-tint border-l-indigo' : 'bg-[#f2f3f5] border-l-ink-ghost')}
      style={{ top, height: Math.max(height, 22) }}
    >
      <div className={clsx('text-[11.5px] font-extrabold leading-tight truncate', booked ? 'text-indigo-ink' : 'text-ink-soft')}>{label}</div>
      <div className={clsx('font-mono text-[10px] font-medium truncate', booked ? 'text-indigo-mid' : 'text-ink-faint')}>{time}</div>
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

function Sheet({ kind, onClose, onSaved }: { kind: 'release' | 'block'; onClose: () => void; onSaved: (m: string) => void }) {
  const [slotType, setSlotType] = useState<'call' | 'meeting'>('call');
  const [date, setDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [from, setFrom] = useState('19:00');
  const [to, setTo] = useState('20:00');
  const [duration, setDuration] = useState(10);
  const [location, setLocation] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [label, setLabel] = useState('');
  const [blockType, setBlockType] = useState<TimetableBlock['block_type']>('davening');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setError(null);
    if (to <= from) { setError('The end time must be after the start.'); setBusy(false); return; }
    if (isDemo()) { setBusy(false); onSaved('Saved.'); return; }

    if (kind === 'release') {
      const { error: err } = await supabase.from('rabbi_slot_releases').insert({
        slot_type: slotType,
        starts_at: new Date(`${date}T${from}:00`).toISOString(),
        ends_at: new Date(`${date}T${to}:00`).toISOString(),
        duration_minutes: duration,
        location: slotType === 'meeting' ? (location.trim() || null) : null,
      });
      setBusy(false);
      if (err) { setError(err.message); return; }
      onSaved('Those times are open — people can book them now.');
    } else {
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
    }
  };

  return (
    <Portal>
      <div onClick={onClose} className="fixed inset-0 z-40 bg-graphite-deep/40" />
      <aside className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[440px] bg-surface flex flex-col shadow-drawer animate-slideIn">
        <header className="px-6 py-5 border-b flex items-center">
          <span className="text-[17px] font-extrabold tracking-tight flex-1">
            {kind === 'release' ? 'Release times' : 'Add to my week'}
          </span>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-ctl grid place-items-center text-ink-muted hover:bg-canvas">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-4">
          {kind === 'release' ? (
            <>
              <div className="flex gap-2">
                {(['call', 'meeting'] as const).map((t) => (
                  <button key={t} onClick={() => { setSlotType(t); setDuration(t === 'call' ? 10 : 30); }}
                    className={clsx('flex-1 rounded-ctl py-3 text-[14px] font-bold border',
                      slotType === t ? 'bg-graphite text-white border-graphite' : 'bg-canvas text-ink-soft')}>
                    {t === 'call' ? 'Phone calls' : 'Meetings'}
                  </button>
                ))}
              </div>
              <Field label="Day"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From"><input type="time" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                <Field label="Until"><input type="time" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              </div>
              <Field label="Minutes per person">
                <div className="flex gap-2">
                  {(slotType === 'call' ? [5, 10, 15] : [15, 30, 45]).map((m) => (
                    <button key={m} onClick={() => setDuration(m)}
                      className={clsx('flex-1 rounded-ctl py-3 text-[14px] font-bold border',
                        duration === m ? 'bg-graphite text-white border-graphite' : 'bg-canvas text-ink-soft')}>{m}</button>
                  ))}
                </div>
              </Field>
              {slotType === 'meeting' && (
                <Field label="Where (optional)">
                  <input className={inputCls} placeholder="e.g. Shul office" value={location} onChange={(e) => setLocation(e.target.value)} />
                </Field>
              )}
            </>
          ) : (
            <>
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
            </>
          )}
          {error && <p className="text-[12.5px] font-bold text-late">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t">
          <Btn tone="dark" busy={busy} className="w-full py-3.5 text-[14.5px]" onClick={save}>
            {kind === 'release' ? 'Open these times' : 'Add to my week'}
          </Btn>
        </footer>
      </aside>
    </Portal>
  );
}
