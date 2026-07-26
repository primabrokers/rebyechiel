import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { isConfigured, missingEnvVars } from './lib/supabase';
import { Display, Spinner } from './components/shared/ui';
import { LoginPage } from './components/auth/LoginPage';
import { SignUpPage } from './components/auth/SignUpPage';
import { HomePage } from './components/community/HomePage';
import { AskShailahPage } from './components/community/AskShailahPage';
import { BookSlotPage } from './components/community/BookSlotPage';
import { MyRequestsPage, RequestDetailPage } from './components/community/MyRequestsPage';
import { RabbiShell } from './components/rabbi/RabbiShell';
import { TodayPage } from './components/rabbi/TodayPage';
import { QueuePage } from './components/rabbi/QueuePage';
import { AnswerShailahPage } from './components/rabbi/AnswerShailahPage';
import { DiaryPage } from './components/rabbi/DiaryPage';
import { MorePage } from './components/rabbi/MorePage';

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
    <div className="min-h-screen flex flex-col justify-center px-6 py-10 max-w-md mx-auto gap-5">
      <div className="w-16 h-16 rounded-2xl bg-midnight text-brass-100 font-display text-3xl flex items-center justify-center shadow-raised">ע</div>
      <Display className="text-[27px]">Nearly there</Display>
      <p className="text-[15px] text-ink-soft">
        This copy of the app was built without its database settings, so it can't start.
      </p>
      <div className="bg-surface rounded-xl shadow-card p-4">
        <div className="text-[11.5px] uppercase tracking-[0.12em] font-extrabold text-ink-muted mb-2">Missing</div>
        <ul className="text-[14px] font-mono text-danger-text flex flex-col gap-1">
          {missingEnvVars.map((v) => <li key={v}>{v}</li>)}
        </ul>
      </div>
      <p className="text-[13.5px] text-ink-muted">
        Add {missingEnvVars.length === 1 ? 'it' : 'them'} in Vercel under Settings → Environment
        Variables, then <strong className="text-ink">redeploy</strong> — the values are baked in
        when the site is built, so an existing deployment won't pick them up.
      </p>
    </div>
  );
}

export default function App() {
  if (!isConfigured) return <SetupNeeded />;
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
          <Route path="/signup" element={<SignUpPage />} />

          <Route path="/" element={<Gate><HomePage /></Gate>} />
          <Route path="/ask" element={<Gate><AskShailahPage /></Gate>} />
          <Route path="/book/:slotType" element={<Gate><BookSlotPage /></Gate>} />
          <Route path="/requests" element={<Gate><MyRequestsPage /></Gate>} />
          <Route path="/requests/:id" element={<Gate><RequestDetailPage /></Gate>} />

          <Route path="/rabbi" element={<Gate admin><RabbiShell /></Gate>}>
            <Route index element={<TodayPage />} />
            <Route path="questions" element={<QueuePage />} />
            <Route path="answer/:id" element={<AnswerShailahPage />} />
            <Route path="diary" element={<DiaryPage />} />
            <Route path="more" element={<MorePage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
