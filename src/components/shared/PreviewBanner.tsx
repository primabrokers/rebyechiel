import { demoRole, exitDemo, isDemo } from '../../lib/demo';

/**
 * Sits above every screen while previewing, so sample data is never mistaken for the real thing.
 * Deliberately loud — this is the only thing standing between a demo and someone believing they
 * are looking at a real person's shailah.
 */
export function PreviewBanner() {
  if (!isDemo()) return null;
  const role = demoRole();
  return (
    <div className="sticky top-0 z-40 bg-brass-500 text-white px-4 py-2 flex items-center justify-between gap-3">
      <span className="text-[12.5px] font-extrabold tracking-tight">
        Preview · sample data · viewing as {role === 'rabbi' ? 'the Rov' : 'a shul member'}
      </span>
      <div className="flex items-center gap-2 flex-none">
        <a
          href={role === 'rabbi' ? '/?preview=member' : '/rabbi?preview=rabbi'}
          className="text-[12px] font-bold underline underline-offset-2"
        >
          Switch
        </a>
        <button onClick={exitDemo} className="text-[12px] font-bold underline underline-offset-2">
          Exit
        </button>
      </div>
    </div>
  );
}
