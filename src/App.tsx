import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { isConfigured, missingEnvVars } from './lib/supabase';
import { isDemo } from './lib/demo';
import { PreviewBanner } from './components/shared/PreviewBanner';
import { PreviewPage } from './components/PreviewPage';
import { Phone, Spinner } from './components/shared/ui';
import { LoginPage } from './components/auth/LoginPage';
import { SignUpPage } from './components/auth/SignUpPage';
import { HomePage } from './components/community/HomePage';
import { AskShailahPage } from './components/community/AskShailahPage';
import { BookSlotPage } from './components/community/BookSlotPage';
import { InvitePage } from './components/community/InvitePage';
import { MyRequestsPage, RequestDetailPage } from './components/community/MyRequestsPage';
import { RabbiShell } from './components/rabbi/RabbiShell';
import { TodayPage } from './components/rabbi/TodayPage';
import { QueuePage } from './components/rabbi/QueuePage';
import { DiaryPage } from './components/rabbi/DiaryPage';
import { RequestsPage } from './components/rabbi/RequestsPage';
import { SettingsPage } from './components/rabbi/SettingsPage';

// Route gate: no session → login; session without a profile → finish signup; admins land on
// /rabbi, everyone else on the community home.
function Gate({ children, admin }: { children: JSX.Element; admin?: boolean }) {
  const { loading, session, profile, needsBootstrap } = useAuth();
  if (loading) return <Spinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (needsBootstrap) return <Navigate to="/signup" replace />;
  if (admin && profile && !['rabbi', 'assistant'].includes(profile.role)) return <Navigate to="/" replace />;
  if (!admin && profile && ['rabbi', 'assistant'].includes(profile.role)) return <Navigate to="/rabbi" replace />;
  return children;
}

function PublicOnly({ children }: { children: JSX.Element }) {
  const { loading, session, profile, needsBootstrap } = useAuth();
  if (isDemo()) return children;
  if (loading) return <Spinner />;
  if (session && !needsBootstrap) {
    return <Navigate to={profile && ['rabbi', 'assistant'].includes(profile.role) ? '/rabbi' : '/'} replace />;
  }
  return children;
}

// Shown when the build went out without its Supabase credentials — otherwise the app would be a
// blank white page with only a console error to go on.
function SetupNeeded() {
  return (
    <Phone tone="surface">
      <div className="flex-1 px-6 pt-14 flex flex-col gap-5">
        <div className="w-[54px] h-[54px] rounded-xl bg-graphite grid place-items-center text-[24px] font-extrabold text-white">ר</div>
        <span className="text-[27px] font-extrabold leading-tight tracking-tight">Nearly there</span>
        <p className="text-[14.5px] leading-relaxed text-ink-soft">
          This copy of the app was built without its database settings, so it can't start.
        </p>
        <div className="bg-canvas border rounded-lg p-4 flex flex-col gap-2">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-ink-muted">Missing</span>
          <ul className="font-mono text-[13.5px] text-late flex flex-col gap-1">
            {missingEnvVars.map((v) => <li key={v}>{v}</li>)}
          </ul>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Add {missingEnvVars.length === 1 ? 'it' : 'them'} in Vercel under Settings → Environment
          Variables, then <strong className="text-ink">redeploy</strong> — the values are baked in
          when the site is built, so an existing deployment won't pick them up.
        </p>
      </div>
    </Phone>
  );
}

export default function App() {
  // Preview mode runs entirely on fixtures, so it works — and stays worth showing someone — even
  // on a build that never got its Supabase credentials.
  if (!isConfigured && !isDemo()) return <SetupNeeded />;
  return (
    <AuthProvider>
      <BrowserRouter>
        <PreviewBanner />
        <Routes>
          <Route path="/preview" element={<PreviewPage />} />
          <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
          <Route path="/signup" element={<SignUpPage />} />

          <Route path="/" element={<Gate><HomePage /></Gate>} />
          <Route path="/ask" element={<Gate><AskShailahPage /></Gate>} />
          <Route path="/book/:slotType" element={<Gate><BookSlotPage /></Gate>} />
          <Route path="/invite" element={<Gate><InvitePage /></Gate>} />
          <Route path="/requests" element={<Gate><MyRequestsPage /></Gate>} />
          <Route path="/requests/:id" element={<Gate><RequestDetailPage /></Gate>} />

          {/* Answering moved into a drawer over the queue, so there is no separate answer route. */}
          <Route path="/rabbi" element={<Gate admin><RabbiShell /></Gate>}>
            <Route index element={<TodayPage />} />
            <Route path="questions" element={<QueuePage />} />
            <Route path="diary" element={<DiaryPage />} />
            <Route path="requests" element={<RequestsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
