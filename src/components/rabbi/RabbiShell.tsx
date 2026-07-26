import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { fetchHandedOffConversations, fetchPendingMeetings, fetchPendingInvitations, fetchQueue } from '../../lib/rabbiData';
import { useAuth } from '../../lib/auth';

/**
 * The Rov's console. Desktop and tablet get a dark side rail with live counts; a phone collapses
 * it to a bottom bar. The rail's "text-in line" panel is deliberately the last thing in the
 * column: it means a person could not be helped by the assistant and needs him to ring.
 */
const NAV = [
  { to: '/rabbi', label: 'Today', icon: '◐', end: true, count: null as null | 'questions' },
  { to: '/rabbi/questions', label: 'Questions', icon: '✦', count: 'questions' as const },
  { to: '/rabbi/diary', label: 'Diary', icon: '▤', count: null },
  { to: '/rabbi/requests', label: 'Requests', icon: '✧', count: 'requests' as const },
  { to: '/rabbi/settings', label: 'Settings', icon: '⚙', count: null },
];

const TITLES: Record<string, [string, string]> = {
  '/rabbi': ['Today', 'What needs you, in the order you promised it.'],
  '/rabbi/questions': ['Questions', 'Every shailah, open and answered.'],
  '/rabbi/diary': ['Diary', 'Your week, and the times people can book.'],
  '/rabbi/requests': ['Requests', 'Calls, meetings and invitations to speak.'],
  '/rabbi/settings': ['Settings', 'Plain switches. Everything saves itself.'],
};

export function RabbiShell() {
  const { profile, signOut } = useAuth();
  const { pathname } = useLocation();
  const [counts, setCounts] = useState({ questions: 0, requests: 0 });
  const [handedOff, setHandedOff] = useState<{ id: string; phone: string }[]>([]);
  const [showNumber, setShowNumber] = useState(false);

  useEffect(() => {
    Promise.all([fetchQueue(), fetchPendingMeetings(), fetchPendingInvitations(), fetchHandedOffConversations()])
      .then(([q, m, i, h]) => {
        setCounts({ questions: q.length, requests: m.length + i.length });
        setHandedOff(h);
      });
  }, [pathname]);

  const [title, sub] = TITLES[pathname] ?? TITLES[Object.keys(TITLES).find((k) => k !== '/rabbi' && pathname.startsWith(k)) ?? '/rabbi'];

  return (
    <div className="min-h-screen flex bg-canvas">
      {/* Side rail — tablet and desktop. */}
      <nav className="hidden md:flex md:flex-col md:w-[236px] md:flex-none md:sticky md:top-0 md:h-screen bg-graphite px-3.5 py-5 gap-5">
        <div className="flex items-center gap-2.5 px-2">
          <div className="w-8 h-8 rounded-ctl bg-indigo grid place-items-center text-[14px] font-extrabold text-white flex-none">ר</div>
          <div className="flex flex-col leading-tight min-w-0">
            <span className="text-[14px] font-extrabold text-white">Rov</span>
            <span className="font-mono text-[10.5px] font-medium text-white/40 truncate">{profile?.full_name ?? 'R. Y. Emanuel'}</span>
          </div>
        </div>

        <div className="flex flex-col gap-[3px]">
          {NAV.map((n) => {
            const badge = n.count ? counts[n.count] : 0;
            return (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => clsx(
                  'flex items-center gap-3 px-3 py-[11px] rounded-ctl transition-colors',
                  isActive ? 'bg-white/10 text-white' : 'text-white/[.62] hover:bg-white/[.07]',
                )}>
                {({ isActive }) => (
                  <>
                    <span className="w-[18px] text-center text-[14px]">{n.icon}</span>
                    <span className="flex-1 text-[13.5px] font-bold">{n.label}</span>
                    {badge > 0 && (
                      <span className={clsx('font-mono text-[11px] font-bold px-[7px] py-[2px] rounded-pill text-white',
                        isActive ? 'bg-indigo' : 'bg-white/10')}>{badge}</span>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </div>

        <div className="mt-auto flex flex-col gap-2.5">
          {handedOff.length > 0 && (
            <div className="p-3 rounded-md bg-indigo/[.16] border border-indigo/[.35] flex flex-col gap-1.5">
              <span className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-indigo-light">Text-in line</span>
              <span className="text-[12.5px] leading-snug text-white/70">
                {handedOff.length === 1 ? 'One caller needs a person.' : `${handedOff.length} callers need a person.`} The
                assistant couldn't finish it by text.
              </span>
              <button onClick={() => setShowNumber(!showNumber)} className="text-[12.5px] font-bold text-white text-left">
                {showNumber ? handedOff.map((h) => h.phone).join(', ') : 'Show the number →'}
              </button>
            </div>
          )}
          <div className="flex items-center gap-2.5 px-2.5 py-2.5 rounded-ctl bg-white/5">
            <span className="w-[7px] h-[7px] rounded-pill bg-good-dot animate-breathe flex-none" />
            <span className="text-[11.5px] text-white/60">Everything saved</span>
            <button onClick={signOut} className="ml-auto text-[11.5px] text-white/40 hover:text-white/70">Sign out</button>
          </div>
        </div>
      </nav>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header bar — the page says what it is and offers the one action that fits it. */}
        <div className="h-16 flex-none flex items-center gap-4 px-5 md:px-6 bg-surface border-b">
          <div className="flex flex-col min-w-0">
            <span className="text-[16px] font-extrabold tracking-tight">{title}</span>
            <span className="text-[12px] text-ink-muted truncate">{sub}</span>
          </div>
          <NavLink to="/rabbi/diary"
            className="ml-auto flex-none rounded-ctl bg-indigo px-4 py-2.5 text-[13px] font-bold text-white hover:bg-indigo-deep">
            <span className="hidden sm:inline">Open times to book</span>
            <span className="sm:hidden">Open times</span>
          </NavLink>
        </div>

        <div className="flex-1 overflow-auto p-5 md:p-6 pb-24 md:pb-8">
          <Outlet />
        </div>
      </div>

      {/* Phone: the rail becomes a bottom bar. */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-graphite flex px-1 pt-1 pb-[max(6px,env(safe-area-inset-bottom))]">
        {NAV.map((n) => {
          const badge = n.count ? counts[n.count] : 0;
          return (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => clsx(
                'flex-1 flex flex-col items-center gap-0.5 py-2 rounded-ctl text-[10px] font-bold relative',
                isActive ? 'bg-white/10 text-white' : 'text-white/[.55]',
              )}>
              <span className="text-[15px] leading-none">{n.icon}</span>
              {n.label}
              {badge > 0 && <span className="absolute top-1 right-1/4 w-1.5 h-1.5 rounded-pill bg-indigo" />}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
