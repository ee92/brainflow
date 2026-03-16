import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { Sidebar } from './Sidebar';
import { DiagramViewer } from './DiagramViewer';
import { useDiagram } from '../hooks/useDiagram';
import { useDiagrams } from '../hooks/useDiagrams';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    function onResize() {
      setIsMobile(window.innerWidth < 768);
    }

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return isMobile;
}

export function Layout({ slugFromRoot }) {
  const params = useParams();
  const slug = params.slug || slugFromRoot || '';
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(isMobile);

  useEffect(() => {
    setCollapsed(isMobile);
  }, [isMobile]);

  const filters = useMemo(() => ({ search: q, sort: 'updated_at', order: 'desc', limit: 50, offset: 0 }), [q]);
  const diagramsQuery = useDiagrams(filters);
  const diagramQuery = useDiagram(slug);

  const diagrams = diagramsQuery.data?.data || [];
  const hasAnyDiagrams = diagramsQuery.data?.meta?.total > 0 || diagrams.length > 0;

  return (
    <div className={`layout${collapsed ? ' sidebar-collapsed' : ''}`}>
      {collapsed ? (
        <button
          type="button"
          className="sidebar-toggle-float"
          onClick={() => setCollapsed(false)}
          aria-label="Open sidebar"
        >☰</button>
      ) : null}
      <Sidebar
        diagrams={diagrams}
        query={q}
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        onSearch={(value) => {
          const next = new URLSearchParams(searchParams);
          if (value) {
            next.set('q', value);
          } else {
            next.delete('q');
          }
          setSearchParams(next, { replace: true });
        }}
      />
      <main className="main-panel">
        {!hasAnyDiagrams && !diagramsQuery.isLoading ? <EmptyState /> : null}
        {diagramQuery.error?.status === 404 ? <ErrorState message="Diagram not found." source="" /> : null}
        {diagramQuery.error?.status !== 404 ? (
          <DiagramViewer
            diagram={diagramQuery.data?.data}
            isLoading={diagramQuery.isLoading}
            error={diagramQuery.error}
          />
        ) : null}
        {!slug && diagrams.length > 0 ? (
          <button
            type="button"
            className="open-latest"
            onClick={() => navigate(`/d/${diagrams[0].slug}${q ? `?q=${encodeURIComponent(q)}` : ''}`)}
          >
            Open latest diagram
          </button>
        ) : null}
      </main>
    </div>
  );
}
