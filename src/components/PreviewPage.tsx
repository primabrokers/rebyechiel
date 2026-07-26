import { Link } from 'react-router-dom';
import { Phone } from './shared/ui';

/**
 * The way in to preview mode: pick which side to look at. Both run on invented data and cannot
 * read or change anything real, so this is safe to hand to the Rov or the committee.
 */
export function PreviewPage() {
  return (
    <Phone tone="graphite">
      <div className="flex-1 px-6 pt-12 flex flex-col gap-6">
        <div className="w-[54px] h-[54px] rounded-xl bg-indigo grid place-items-center text-[24px] font-extrabold text-white">ר</div>
        <div className="flex flex-col gap-2.5">
          <span className="text-[29px] font-extrabold leading-[1.18] text-white">Have a<br />look round</span>
          <span className="text-[14.5px] leading-relaxed text-white/[.62]">
            No login needed. Everything you see is made up — nothing here reads or changes anything real.
          </span>
        </div>
      </div>

      <div className="bg-surface rounded-t-[26px] px-5 pt-6 pb-7 flex flex-col gap-2.5">
        <a href="/rabbi?preview=rabbi" className="rounded-xl bg-graphite p-4 flex items-center gap-3.5">
          <div className="w-[42px] h-[42px] rounded-md bg-white/[.14] grid place-items-center text-[17px] text-white flex-none">◐</div>
          <div className="flex-1 flex flex-col gap-0.5">
            <span className="text-[15.5px] font-extrabold text-white">The Rov's console</span>
            <span className="text-[12px] text-white/60">Today, the queue, answering, his diary</span>
          </div>
          <span className="text-[17px] text-white/70 flex-none">›</span>
        </a>

        <a href="/?preview=member" className="rounded-xl bg-surface border p-4 flex items-center gap-3.5">
          <div className="w-[42px] h-[42px] rounded-md bg-chip grid place-items-center text-[17px] flex-none">✦</div>
          <div className="flex-1 flex flex-col gap-0.5">
            <span className="text-[15.5px] font-extrabold">A member's side</span>
            <span className="text-[12px] text-ink-muted">Asking a shailah, booking a call, inviting him</span>
          </div>
          <span className="text-[17px] text-ink-ghost flex-none">›</span>
        </a>

        <Link to="/login" className="text-[13px] font-bold text-indigo text-center pt-2">Sign in properly instead</Link>
      </div>
    </Phone>
  );
}
