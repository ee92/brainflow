import { Navigate, Route, Routes } from 'react-router-dom';
import { EmptyState } from './components/EmptyState';
import { Layout } from './components/Layout';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { useDiagrams } from './hooks/useDiagrams';

function RootRoute(): JSX.Element {
  const { data, isLoading } = useDiagrams({ sort: 'updated_at', order: 'desc', limit: 1, offset: 0 });

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (data?.ok) {
    const latest = data.data[0];
    if (latest?.slug) {
      return <Navigate to={`/d/${latest.slug}`} replace />;
    }
  }

  return (
    <div className="layout">
      <main className="main-panel">
        <EmptyState />
      </main>
    </div>
  );
}

function NotFoundPage(): JSX.Element {
  return (
    <div className="not-found">
      <h1>404</h1>
      <p>Page not found.</p>
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<RootRoute />} />
      <Route path="/d/:slug" element={<Layout />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
