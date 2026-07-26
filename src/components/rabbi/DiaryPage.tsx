import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Plus, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { supabase } from '../../lib/supabase';
import { isDemo } from '../../lib/demo';
import { fetchProfilesByIds, fetchSlotReleases, fetchTimetable, fetchUpcomingBookings } from '../../lib/rabbiData';
import type { Booking, Profile, SlotRelease, TimetableBlock } from '../../types';
import { BigButton, Display, Field, Pill, SectionLabel, Spinner, inputCls } from '../shared/ui';
import { WEEKDAYS, fmtSlot } from '../../lib/format';

const BLOCK_TYPES = [
  { key: 'davening', label: 'Davening' },
  { key: 'shiur', label: 'Shiur' },
  { key: 'school', label: 'School' },
  { key: 'chosson', label: 'Chosson lesson' },
  { key: 'family', label: 'Family time' },
  { key: 'other', label: 'Other' },
] as const;

// Diary tab: the week ahead (bookings), release call/meeting times, and the fixed weekly
// timetable that blocks everything else out.
export function DiaryPage() {
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [releases, setReleases] = useState<SlotRelease[]>([]);
  const [blocks, setBlocks] = useState<TimetableBlock[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [showRelease, setShowRelease] = useState(false);
  const [showBlock, setShowBlock] = useState(false);

  const load = async () => {
    const [b, r, t] = await Promise.all([fetchUpcomingBookings(14), fetchSlotReleases(), fetchTimetable()]);
    setBookings(b); setReleases(r); setBlocks(t);
    setProfiles(await fetchProfilesByIds(b.map((x) => x.profile_id).filter(Boolean) as string[]));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  if (loading) return <Spinner />;

  const who = (b: Booking) =>
    (b.profile_id && profiles.get(b.profile_id)?.full_name) || b.contact_name || 'Text-in caller';

  const closeRelease = async (id: string) => {
    if (isDemo()) return;
    await supabase.from('rabbi_slot_releases').update({ status: 'closed' }).eq('id', id);
    await load();
  };
  const removeBlock = async (id: string) => {
    if (isDemo()) return;
    await supabase.from('rabbi_timetable_blocks').update({ is_active: false }).eq('id', id);
    await load();
  };

  return (
    <div className="flex flex-col gap-3 px-4 md:px-8 lg:px-10 pt-8 md:max-w-5xl">
      <div className="px-1.5">
        <Display className="text-[26px]">Diary</Display>
        <p className="text-[13.5px] text-ink-muted mt-1">Appointments, released times, and your fixed week.</p>
      </div>

      <SectionLabel>Next two weeks</SectionLabel>
      {bookings.length === 0 && <p className="text-[14px] text-ink-muted px-2">No appointments booked.</p>}
      {bookings.map((b) => (
        <div key={b.id} className="bg-surface rounded-xl shadow-card p-4 flex items-center gap-3">
          <div className="flex-1">
            <div className="font-extrabold text-[15.5px] tracking-tight">
              {b.slot_type === 'call' ? 'Phone call' : 'Meeting'} — {who(b)}
            </div>
            <div className="text-[13px] text-ink-muted">{fmtSlot(b.starts_at)}{b.purpose ? ` · ${b.purpose}` : ''}</div>
          </div>
          <Pill tone={b.status === 'confirmed' ? 'ok' : 'warn'}>{b.status === 'confirmed' ? 'Confirmed' : 'To approve'}</Pill>
        </div>
      ))}

      <SectionLabel action={
        <button onClick={() => setShowRelease(true)} className="text-[12.5px] font-bold text-royal-600 flex items-center gap-1">
          <Plus size={15} /> Release times
        </button>
      }>
        Released times
      </SectionLabel>
      {releases.filter((r) => r.status === 'open').length === 0 && (
        <p className="text-[14px] text-ink-muted px-2">Nothing released — tap "Release times" to open call or meeting slots.</p>
      )}
      {releases.filter((r) => r.status === 'open').map((r) => (
        <div key={r.id} className="bg-surface rounded-xl shadow-card p-4 flex items-center gap-3">
          <div className="flex-1">
            <div className="font-extrabold text-[15.5px] tracking-tight">
              {r.slot_type === 'call' ? 'Calls' : 'Meetings'} · {fmtSlot(r.starts_at)}–{format(new Date(r.ends_at), 'HH:mm')}
            </div>
            <div className="text-[13px] text-ink-muted">{r.duration_minutes} min each{r.location ? ` · ${r.location}` : ''}</div>
          </div>
          <button onClick={() => closeRelease(r.id)} className="p-2.5 text-ink-faint" aria-label="Close these times">
            <X size={19} />
          </button>
        </div>
      ))}

      <SectionLabel action={
        <button onClick={() => setShowBlock(true)} className="text-[12.5px] font-bold text-royal-600 flex items-center gap-1">
          <Plus size={15} /> Add
        </button>
      }>
        My fixed week
      </SectionLabel>
      <div className="bg-surface rounded-xl shadow-card px-4 py-1">
        {blocks.length === 0 && (
          <p className="text-[14px] text-ink-muted py-3 text-center">
            Add your fixed commitments — davening, school, shiurim — so no one can ever book over them.
          </p>
        )}
        {blocks.map((b) => (
          <div key={b.id} className="flex items-center gap-3 py-2.5 border-b border-separator last:border-0">
            <span className="w-[64px] text-[13px] font-extrabold text-midnight flex-none">{WEEKDAYS[b.weekday].slice(0, 3)}</span>
            <span className="text-[13.5px] font-bold tabular-nums flex-none">{b.start_time.slice(0, 5)}–{b.end_time.slice(0, 5)}</span>
            <span className="text-[14px] flex-1 truncate">{b.label}</span>
            <button onClick={() => removeBlock(b.id)} className="p-1.5 text-ink-faint" aria-label="Remove"><Trash2 size={16} /></button>
          </div>
        ))}
      </div>

      {showRelease && <ReleaseSheet onClose={() => { setShowRelease(false); load(); }} />}
      {showBlock && <BlockSheet onClose={() => { setShowBlock(false); load(); }} />}
    </div>
  );
}

function SheetShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 bg-midnight/40 flex items-end justify-center" onClick={onClose}>
      <div className="bg-paper w-full max-w-md rounded-t-2xl p-5 pb-8 flex flex-col gap-4 max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="font-display font-semibold text-[21px] tracking-tight">{title}</span>
          <button onClick={onClose} className="p-2 text-ink-faint"><X size={22} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// "Release times": one window (e.g. Sunday 19:00–20:00, 10-minute calls) → many bookable slots.
function ReleaseSheet({ onClose }: { onClose: () => void }) {
  const [slotType, setSlotType] = useState<'call' | 'meeting'>('call');
  const [date, setDate] = useState(format(new Date(Date.now() + 86_400_000), 'yyyy-MM-dd'));
  const [from, setFrom] = useState('19:00');
  const [to, setTo] = useState('20:00');
  const [duration, setDuration] = useState(10);
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveRelease = async () => {
    if (isDemo()) { onClose(); return; }
    setBusy(true); setError(null);
    const starts = new Date(`${date}T${from}:00`);
    const ends = new Date(`${date}T${to}:00`);
    if (!(ends > starts)) { setError('The end time must be after the start.'); setBusy(false); return; }
    const { error: err } = await supabase.from('rabbi_slot_releases').insert({
      slot_type: slotType,
      starts_at: starts.toISOString(),
      ends_at: ends.toISOString(),
      duration_minutes: duration,
      location: slotType === 'meeting' ? (location.trim() || null) : null,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onClose();
  };

  return (
    <SheetShell title="Release times" onClose={onClose}>
      <div className="flex gap-2">
        {(['call', 'meeting'] as const).map((t) => (
          <button key={t} onClick={() => { setSlotType(t); setDuration(t === 'call' ? 10 : 30); }}
            className={clsx('flex-1 rounded-lg py-3 font-extrabold text-[15px]',
              slotType === t ? 'bg-midnight text-white' : 'bg-surface shadow-card text-ink-soft')}>
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
              className={clsx('flex-1 rounded-lg py-3 font-extrabold text-[15px]',
                duration === m ? 'bg-midnight text-white' : 'bg-surface shadow-card text-ink-soft')}>
              {m}
            </button>
          ))}
        </div>
      </Field>
      {slotType === 'meeting' && (
        <Field label="Where (optional)">
          <input className={inputCls} placeholder="e.g. Shul office" value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
      )}
      {error && <p className="text-danger-text text-sm font-bold">{error}</p>}
      <BigButton busy={busy} onClick={saveRelease}>Release these times</BigButton>
    </SheetShell>
  );
}

function BlockSheet({ onClose }: { onClose: () => void }) {
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [from, setFrom] = useState('07:00');
  const [to, setTo] = useState('08:00');
  const [label, setLabel] = useState('');
  const [blockType, setBlockType] = useState<TimetableBlock['block_type']>('davening');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (d: number) =>
    setWeekdays((w) => w.includes(d) ? w.filter((x) => x !== d) : [...w, d]);

  const saveBlock = async () => {
    if (isDemo()) { onClose(); return; }
    setBusy(true); setError(null);
    if (!weekdays.length) { setError('Pick at least one day.'); setBusy(false); return; }
    if (to <= from) { setError('The end time must be after the start.'); setBusy(false); return; }
    const rows = weekdays.map((weekday) => ({
      weekday, start_time: from, end_time: to,
      label: label.trim() || BLOCK_TYPES.find((b) => b.key === blockType)?.label || 'Busy',
      block_type: blockType,
    }));
    const { error: err } = await supabase.from('rabbi_timetable_blocks').insert(rows);
    setBusy(false);
    if (err) { setError(err.message); return; }
    onClose();
  };

  return (
    <SheetShell title="Add to my fixed week" onClose={onClose}>
      <Field label="What is it?">
        <div className="grid grid-cols-3 gap-2">
          {BLOCK_TYPES.map((b) => (
            <button key={b.key} onClick={() => setBlockType(b.key)}
              className={clsx('rounded-lg py-2.5 px-1 font-bold text-[13px]',
                blockType === b.key ? 'bg-midnight text-white' : 'bg-surface shadow-card text-ink-soft')}>
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
            <button key={d} onClick={() => toggleDay(i)}
              className={clsx('rounded-full px-3.5 py-2 font-extrabold text-[13px]',
                weekdays.includes(i) ? 'bg-midnight text-white' : 'bg-surface shadow-card text-ink-soft')}>
              {d.slice(0, 3)}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From"><input type="time" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Until"><input type="time" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {error && <p className="text-danger-text text-sm font-bold">{error}</p>}
      <BigButton busy={busy} onClick={saveBlock}>Add to my week</BigButton>
    </SheetShell>
  );
}
