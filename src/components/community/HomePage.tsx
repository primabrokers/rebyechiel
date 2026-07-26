import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, MessageCircleQuestion, Phone, Users, LogOut } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { AFFILIATION_LABELS, type Booking, type Shailah } from '../../types';
import { Display, Pill, SectionLabel } from '../shared/ui';
import { fmtSlot } from '../../lib/format';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const STATUS_PILL: Record<string, { tone: 'ok' | 'warn' | 'bad' | 'info'; label: string }> = {
  new: { tone: 'warn', label: 'With the Rov' },
  triaged: { tone: 'warn', label: 'With the Rov' },
  in_progress: { tone: 'warn', label: 'Being looked at' },
  answered: { tone: 'ok', label: 'Answered' },
  closed: { tone: 'info', label: 'Closed' },
  withdrawn: { tone: 'info', label: 'Withdrawn' },
  requested: { tone: 'warn', label: 'Awaiting the Rov' },
  confirmed: { tone: 'ok', label: 'Confirmed' },
  declined: { tone: 'bad', label: 'Not possible' },
  cancelled: { tone: 'info', label: 'Cancelled' },
  completed: { tone: 'info', label: 'Done' },
  rescheduled: { tone: 'warn', label: 'Rescheduled' },
};

export function HomePage() {
  const { profile, signOut } = useAuth();
  const [shailos, setShailos] = useState<Shailah[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);

  useEffect(() => {
    if (!profile) return;
    // RLS scopes both queries to the caller's own rows.
    supabase.from('rabbi_shailos').select('*').order('created_at', { ascending: false }).limit(5)
      .then(({ data }) => setShailos((data as Shailah[]) ?? []));
    supabase.from('rabbi_bookings').select('*').in('status', ['requested', 'confirmed'])
      .gte('starts_at', new Date().toISOString()).order('starts_at').limit(5)
      .then(({ data }) => setBookings((data as Booking[]) ?? []));
  }, [profile]);

  const open = shailos.filter((s) => !['closed', 'withdrawn'].includes(s.status));

  return (
    <div className="min-h-screen max-w-md mx-auto px-5 pt-8 pb-12 flex flex-col gap-3.5">
      <div className="px-1.5 flex items-start justify-between">
        <div>
          <div className="text-[12.5px] font-bold tracking-[0.1em] uppercase text-brass-500">
            {format(new Date(), 'EEEE d MMMM')}
          </div>
          <Display className="text-[30px] mt-1">{greeting()},<br />{profile?.full_name?.split(' ')[0]}</Display>
          {profile?.affiliation && (
            <p className="text-[13px] text-ink-muted mt-1.5">{AFFILIATION_LABELS[profile.affiliation]}</p>
          )}
        </div>
        <button onClick={signOut} className="p-2.5 text-ink-faint" aria-label="Sign out"><LogOut size={19} /></button>
      </div>

      <Link to="/ask" className="masthead text-white rounded-2xl shadow-raised p-5 flex items-center gap-4">
        <div className="w-[54px] h-[54px] rounded-xl bg-white/15 flex items-center justify-center flex-none">
          <MessageCircleQuestion size={26} />
        </div>
        <div className="flex-1">
          <div className="font-extrabold text-[17.5px] tracking-tight">Ask a shailah</div>
          <div className="text-[13px] opacity-75">Private — only the Rov sees it</div>
        </div>
        <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center flex-none"><ChevronRight size={20} /></div>
      </Link>

      <Link to="/book/call" className="bg-surface rounded-2xl shadow-card p-5 flex items-center gap-4">
        <div className="w-[54px] h-[54px] rounded-xl bg-royal-100 text-royal-600 flex items-center justify-center flex-none">
          <Phone size={24} />
        </div>
        <div className="flex-1">
          <div className="font-extrabold text-[17.5px] tracking-tight">Book a phone call</div>
          <div className="text-[13px] text-ink-muted">From times the Rov has set aside</div>
        </div>
        <div className="w-9 h-9 rounded-full bg-paper text-ink-soft flex items-center justify-center flex-none"><ChevronRight size={20} /></div>
      </Link>

      <Link to="/book/meeting" className="bg-surface rounded-2xl shadow-card p-5 flex items-center gap-4">
        <div className="w-[54px] h-[54px] rounded-xl bg-royal-100 text-royal-600 flex items-center justify-center flex-none">
          <Users size={24} />
        </div>
        <div className="flex-1">
          <div className="font-extrabold text-[17.5px] tracking-tight">Request a meeting</div>
          <div className="text-[13px] text-ink-muted">Face to face with the Rov</div>
        </div>
        <div className="w-9 h-9 rounded-full bg-paper text-ink-soft flex items-center justify-center flex-none"><ChevronRight size={20} /></div>
      </Link>

      {(open.length > 0 || bookings.length > 0) && (
        <>
          <SectionLabel action={<Link to="/requests" className="text-[12.5px] font-bold text-royal-600">All →</Link>}>
            My requests
          </SectionLabel>
          {bookings.map((b) => (
            <Link key={b.id} to={`/requests`} className="bg-surface rounded-xl shadow-card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-extrabold text-[15.5px] tracking-tight">
                  {b.slot_type === 'call' ? 'Phone call' : 'Meeting'} · {fmtSlot(b.starts_at)}
                </span>
                <Pill tone={STATUS_PILL[b.status]?.tone ?? 'info'}>{STATUS_PILL[b.status]?.label ?? b.status}</Pill>
              </div>
            </Link>
          ))}
          {open.map((s) => (
            <Link key={s.id} to={`/requests/${s.id}`} className="bg-surface rounded-xl shadow-card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-extrabold text-[15.5px] tracking-tight">Question {s.ref}</span>
                <Pill tone={STATUS_PILL[s.status]?.tone ?? 'info'}>{STATUS_PILL[s.status]?.label ?? s.status}</Pill>
              </div>
              {s.status !== 'answered' && s.expected_reply_text && (
                <p className="text-[13.5px] text-ink-soft">{s.expected_reply_text} We'll text you.</p>
              )}
              {s.status === 'answered' && <p className="text-[13.5px] text-success-text font-bold">Tap to read the Rov's answer</p>}
            </Link>
          ))}
        </>
      )}
    </div>
  );
}
