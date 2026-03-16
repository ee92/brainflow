import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { EmptyState } from './components/EmptyState';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { useDiagrams } from './hooks/useDiagrams';

function RootRoute() {
  const { data, isLoading } = useDiagrams({ sort: 'updated_at', order: 'desc', limit: 1, offset: 0 });

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  const latest = data?.data?.[0];
  if (latest?.slug) {
    return <Navigate to={`/d/${latest.slug}`} replace />;
  }

  return (
    <div className="layout">
      <main className="main-panel">
        <EmptyState />
      </main>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="not-found">
      <h1>404</h1>
      <p>Page not found.</p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRoute />} />
      <Route path="/d/:slug" element={<Layout />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
