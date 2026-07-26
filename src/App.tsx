import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Spinner } from './components/shared/ui';
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

export default function App() {
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
