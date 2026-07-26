import { NavLink, Outlet } from 'react-router-dom';
import { Sun, MessageCircleQuestion, CalendarDays, Settings } from 'lucide-react';
import clsx from 'clsx';

// The Rov's shell: bigger base type, four fixed tabs in a floating pill bar, no other chrome.
const TABS = [
  { to: '/rabbi', label: 'Today', icon: Sun, end: true },
  { to: '/rabbi/questions', label: 'Questions', icon: MessageCircleQuestion },
  { to: '/rabbi/diary', label: 'Diary', icon: CalendarDays },
  { to: '/rabbi/more', label: 'More', icon: Settings },
];

export function RabbiShell() {
  return (
    <div className="rabbi-shell min-h-screen max-w-md mx-auto relative">
      <div className="pb-28">
        <Outlet />
      </div>
      <nav className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[400px] z-30
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
