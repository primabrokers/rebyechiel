import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format, isToday } from 'date-fns';
import { api } from '../../lib/api';
import {
  fetchLatestBriefing, fetchPendingMeetings, fetchProfilesByIds, fetchQueue,
  fetchTimetable, fetchUpcomingBookings, fetchHandedOffConversations,
} from '../../lib/rabbiData';
import type { Booking, Profile, Shailah, TimetableBlock } from '../../types';
import { AFFILIATION_LABELS } from '../../types';
import { BigButton, Pill, SectionLabel, Spinner } from '../shared/ui';
import { fmtSlot } from '../../lib/format';

// The Rov's landing screen: the day's shape as three numbers, his AI briefing, then the few
// things that need him — questions due today, meetings to approve, today's diary.
export function TodayPage() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<Shailah[]>([]);
  const [pending, setPending] = useState<Booking[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blocks, setBlocks] = useState<TimetableBlock[]>([]);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [handedOff, setHandedOff] = useState<{ id: string; phone: string }[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    const [q, p, b, t, br, ho] = await Promise.all([
      fetchQueue(), fetchPendingMeetings(), fetchUpcomingBookings(1), fetchTimetable(),
      fetchLatestBriefing(), fetchHandedOffConversations(),
    ]);
    setQueue(q); setPending(p); setBookings(b); setBlocks(t); setBriefing(br); setHandedOff(ho);
    setProfiles(await fetchProfilesByIds([
      ...q.map((s) => s.profile_id), ...p.map((x) => x.profile_id), ...b.map((x) => x.profile_id),
    ].filter(Boolean) as string[]));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  if (loading) return <Spinner />;

  const now = new Date();
  const weekday = now.getDay();
  const todayBlocks = blocks.filter((b) => b.weekday === weekday);
  const dueToday = queue.filter((s) => s.due_at && (new Date(s.due_at) <= now || isToday(new Date(s.due_at))));
  const todaysBookings = bookings.filter((b) => isToday(new Date(b.starts_at)) && b.status === 'confirmed');

  const who = (s: { profile_id: string | null; contact_name?: string | null }) =>
    (s.profile_id && profiles.get(s.profile_id)?.full_name) || s.contact_name || 'Text-in caller';
  const affOf = (pid: string | null) => {
    const a = pid ? profiles.get(pid)?.affiliation : null;
    return a ? AFFILIATION_LABELS[a] : null;
  };

  const actMeeting = async (id: string, status: 'confirmed' | 'declined') => {
    setBusyId(id);
    try {
      await api('set_booking_status', { bookingId: id, status });
      await load();
    } finally { setBusyId(null); }
  };

  return (
    <div className="flex flex-col gap-3.5 px-4">
      <div className="masthead text-white -mx-4 px-7 pt-10 pb-16">
        <div className="text-[12px] tracking-[0.14em] uppercase font-bold text-brass-300/95">
          {format(now, 'EEEE · d MMMM')}
        </div>
        <h2 className="font-display font-semibold text-[30px] tracking-tight mt-1.5">
          {now.getHours() < 12 ? 'Boker tov, Rebbe' : now.getHours() < 19 ? 'Good afternoon, Rebbe' : 'Good evening, Rebbe'}
        </h2>
        <div className="flex gap-6 mt-4">
          <div>
            <div className={`text-[24px] font-extrabold leading-tight tabular-nums ${dueToday.length ? 'text-[#F0B9A8]' : ''}`}>{dueToday.length}</div>
            <div className="text-[11.5px] opacity-75">due today</div>
          </div>
          <div>
            <div className="text-[24px] font-extrabold leading-tight tabular-nums">{todaysBookings.length}</div>
            <div className="text-[11.5px] opacity-75">{todaysBookings.length === 1 ? 'appointment' : 'appointments'}</div>
          </div>
          <div>
            <div className="text-[24px] font-extrabold leading-tight tabular-nums">{pending.length}</div>
            <div className="text-[11.5px] opacity-75">to approve</div>
          </div>
        </div>
      </div>

      {briefing && (
        <div className="glass-card rounded-2xl shadow-raised p-4.5 p-5 -mt-14 relative z-10">
          <div className="text-[11px] tracking-[0.13em] uppercase font-extrabold text-brass-500 mb-1.5">Your morning briefing</div>
          <p className="text-[14.5px] leading-relaxed whitespace-pre-wrap">{briefing}</p>
        </div>
      )}

      {dueToday.length > 0 && (
        <>
          <SectionLabel action={<Link to="/rabbi/questions" className="text-[12.5px] font-bold text-royal-600">All {queue.length} →</Link>}>
            Answer today
          </SectionLabel>
          {dueToday.slice(0, 3).map((s) => (
            <div key={s.id} className="bg-surface rounded-xl shadow-card p-4 priority-spine flex flex-col gap-2.5 pl-5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-extrabold text-[17px] tracking-tight">
                  {s.is_sensitive ? 'Private matter' : who(s)}
                </span>
                <Pill tone="bad">{s.due_at && new Date(s.due_at) < now ? 'Overdue' : 'Due today'}</Pill>
              </div>
              {!s.is_sensitive && s.ai_summary && <p className="text-[14px] text-ink-soft">{s.ai_summary}</p>}
              {s.is_sensitive && <p className="text-[14px] text-ink-soft">Details shown only when you open it</p>}
              <BigButton onClick={() => nav(`/rabbi/answer/${s.id}`)}>Answer</BigButton>
            </div>
          ))}
        </>
      )}

      {pending.length > 0 && (
        <>
          <SectionLabel>Waiting for your OK</SectionLabel>
          {pending.map((b) => (
            <div key={b.id} className="bg-surface rounded-xl shadow-card p-4 flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-extrabold text-[17px] tracking-tight">Meeting — {who(b)}</span>
                {affOf(b.profile_id) && <Pill tone="brass">{affOf(b.profile_id)}</Pill>}
              </div>
              <p className="text-[14px] text-ink-soft">
                {fmtSlot(b.starts_at)}{b.purpose ? ` · "${b.purpose}"` : ''}
              </p>
              <div className="flex gap-2.5">
                <BigButton tone="success" busy={busyId === b.id} className="flex-1 min-h-[50px] py-3 text-[15px]"
                  onClick={() => actMeeting(b.id, 'confirmed')}>Approve</BigButton>
                <BigButton tone="ghost" busy={busyId === b.id} className="flex-1 min-h-[50px] py-3 text-[15px]"
                  onClick={() => actMeeting(b.id, 'declined')}>Can't make it</BigButton>
              </div>
            </div>
          ))}
        </>
      )}

      {handedOff.length > 0 && (
        <>
          <SectionLabel>Please phone back</SectionLabel>
          {handedOff.map((c) => (
            <div key={c.id} className="bg-surface rounded-xl shadow-card p-4">
              <p className="text-[15px]"><span className="font-extrabold">{c.phone}</span> texted in and needs a person — the assistant couldn't finish it by text.</p>
            </div>
          ))}
        </>
      )}

      <SectionLabel>Today's diary</SectionLabel>
      <div className="bg-surface rounded-xl shadow-card px-4 py-2">
        {todayBlocks.length === 0 && todaysBookings.length === 0 && (
          <p className="text-[14px] text-ink-muted py-3 text-center">Nothing fixed in the diary today.</p>
        )}
        {[...todayBlocks.map((b) => ({
          key: `b-${b.id}`, time: b.start_time.slice(0, 5), label: b.label, sub: null as string | null, brass: false,
        })), ...todaysBookings.map((b) => ({
          key: `k-${b.id}`,
          time: format(new Date(b.starts_at), 'HH:mm'),
          label: `${b.slot_type === 'call' ? 'Phone call' : 'Meeting'} — ${who(b)}`,
          sub: b.purpose, brass: true,
        }))].sort((a, b2) => a.time.localeCompare(b2.time)).map((row) => (
          <div key={row.key} className="flex gap-3.5 py-2.5 border-b border-separator last:border-0 items-baseline">
            <span className="w-[50px] text-right font-extrabold tabular-nums text-[14.5px] text-midnight flex-none">{row.time}</span>
            <span className={`w-2.5 h-2.5 rounded-full flex-none translate-y-[-1px] border-[3px] bg-surface ${row.brass ? 'border-brass-500' : 'border-royal-600'}`} />
            <div>
              <div className="text-[14.5px] font-bold">{row.label}</div>
              {row.sub && <div className="text-[12.5px] text-ink-muted">{row.sub}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
