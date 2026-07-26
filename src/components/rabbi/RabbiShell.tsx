import { NavLink, Outlet } from 'react-router-dom';
import { Sun, MessageCircleQuestion, CalendarDays, Settings } from 'lucide-react';
import clsx from 'clsx';

/**
 * The Rov's shell. He works from a phone, an Android tablet and a desktop, so navigation changes
 * shape rather than stretching: a floating pill bar within thumb reach on a phone, and a fixed
 * side rail from tablet width up, where reaching the bottom of a big screen is awkward. The pages
 * themselves widen into columns at `lg` — see each page for its own layout.
 */
const TABS = [
  { to: '/rabbi', label: 'Today', icon: Sun, end: true },
  { to: '/rabbi/questions', label: 'Questions', icon: MessageCircleQuestion },
  { to: '/rabbi/diary', label: 'Diary', icon: CalendarDays },
  { to: '/rabbi/more', label: 'More', icon: Settings },
];

export function RabbiShell() {
  return (
    <div className="rabbi-shell min-h-screen md:flex">
      {/* Side rail — tablet and desktop. */}
      <nav className="hidden md:flex md:flex-col md:w-60 lg:w-64 md:flex-none md:sticky md:top-0 md:h-screen
        bg-[#0F1E33] text-white px-4 py-6 gap-1">
        <div className="flex items-center gap-3 px-2 pb-6">
          <div className="w-11 h-11 rounded-xl bg-white/10 text-brass-100 font-display text-2xl flex items-center justify-center flex-none">ע</div>
          <div className="leading-tight">
            <div className="font-extrabold text-[15px] tracking-tight">Rabbi Emanuel</div>
            <div className="text-[12px] text-white/55">Assistant</div>
          </div>
        </div>
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => clsx(
              'flex items-center gap-3 px-3 py-3 rounded-xl text-[15px] font-bold transition-colors',
              isActive ? 'bg-white/15 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white/90',
            )}>
            {({ isActive }) => (
              <>
                <Icon size={20} className="flex-none" />
                <span className="flex-1">{label}</span>
                {isActive && <span className="w-1.5 h-1.5 rounded-full bg-brass-300 flex-none" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Content: phone-width column on a phone, widening with the screen from tablet up. */}
      <div className="flex-1 min-w-0">
        <div className="max-w-md md:max-w-none mx-auto pb-28 md:pb-10">
          <Outlet />
        </div>
      </div>

      {/* Floating tab bar — phones only; the side rail replaces it from md up. */}
      <nav className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[400px] z-30
        bg-[rgba(15,25,44,0.96)] backdrop-blur-md rounded-full flex p-1.5 shadow-tabbar">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => clsx(
              'flex-1 flex flex-col items-center gap-0.5 py-2 rounded-full text-[10.5px] font-bold transition-colors',
              isActive ? 'bg-white/15 text-white' : 'text-white/55',
            )}>
            {({ isActive }) => (
              <>
                <Icon size={21} />
                {label}
                {isActive && <span className="w-1 h-1 rounded-full bg-brass-300" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
