import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import Overview from './pages/Overview';
import RealtimePage from './pages/RealtimePage';
import Performance from './pages/Performance';
import Errors from './pages/Errors';
import ErrorDetail from './pages/ErrorDetail';
import Behavior from './pages/Behavior';
import Sessions from './pages/Sessions';
import SessionDetail from './pages/SessionDetail';
import Users from './pages/Users';
import Projects from './pages/Projects';
import Alerts from './pages/Alerts';
import Connect from './pages/Connect';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="overview" element={<Overview />} />
        <Route path="realtime" element={<RealtimePage />} />
        <Route path="performance" element={<Performance />} />
        <Route path="errors" element={<Errors />} />
        <Route path="errors/:id" element={<ErrorDetail />} />
        <Route path="behavior" element={<Behavior />} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="sessions/:sessionId" element={<SessionDetail />} />
        <Route path="users" element={<Users />} />
        <Route path="projects" element={<Projects />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="connect" element={<Connect />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Route>
    </Routes>
  );
}
