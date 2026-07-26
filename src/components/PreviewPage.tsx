import { Link } from 'react-router-dom';
import { ChevronRight, MessageCircleQuestion, Sun } from 'lucide-react';
import { Display } from './shared/ui';

/**
 * The way in to preview mode: pick which side to look at. Both run on invented data and cannot
 * read or change anything real, so this is safe to share with the Rov or the committee.
 */
export function PreviewPage() {
  return (
    <div className="min-h-screen flex flex-col justify-center px-6 py-10 max-w-md mx-auto gap-4">
      <div className="w-16 h-16 rounded-2xl bg-midnight text-brass-100 font-display text-3xl flex items-center justify-center shadow-raised">ע</div>
      <Display className="text-[28px]">Have a look round</Display>
      <p className="text-[14.5px] text-ink-soft">
        No login needed. Everything you see is made up — nothing here reads or changes real
        information.
      </p>

      <a href="/rabbi?preview=rabbi" className="masthead text-white rounded-2xl shadow-raised p-5 flex items-center gap-4 mt-2">
        <div className="w-[54px] h-[54px] rounded-xl bg-white/15 flex items-center justify-center flex-none">
          <Sun size={26} />
        </div>
        <div className="flex-1">
          <div className="font-extrabold text-[17.5px] tracking-tight">The Rov's side</div>
          <div className="text-[13px] opacity-75">Today, the question queue, answering, the diary</div>
        </div>
        <ChevronRight size={20} className="flex-none opacity-75" />
      </a>

      <a href="/?preview=member" className="bg-surface rounded-2xl shadow-card p-5 flex items-center gap-4">
        <div className="w-[54px] h-[54px] rounded-xl bg-royal-100 text-royal-600 flex items-center justify-center flex-none">
          <MessageCircleQuestion size={24} />
        </div>
        <div className="flex-1">
          <div className="font-extrabold text-[17.5px] tracking-tight">A shul member's side</div>
          <div className="text-[13px] text-ink-muted">Asking a shailah, booking a call, tracking requests</div>
        </div>
        <ChevronRight size={20} className="flex-none text-ink-muted" />
      </a>

      <Link to="/login" className="text-[13.5px] font-bold text-royal-600 text-center mt-3">
        Sign in properly instead
      </Link>
    </div>
  );
}
