import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams, type NavigateFunction } from 'react-router-dom';
import { isApiClientError } from '../api/client';
import { useDiagram } from '../hooks/useDiagram';
import { useDiagrams } from '../hooks/useDiagrams';
import type { DiagramFilters, DiagramSummary } from '../types/models';
import { DiagramViewer } from './DiagramViewer';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { Sidebar } from './Sidebar';

interface LayoutProps {
  slugFromRoot?: string;
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768);

  useEffect((): (() => void) => {
    const onResize = (): void => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener('resize', onResize);
    return (): void => window.removeEventListener('resize', onResize);
  }, []);

  return isMobile;
}

export function Layout({ slugFromRoot = '' }: LayoutProps): JSX.Element {
  const params = useParams();
  const slug: string = params.slug || slugFromRoot || '';
  const [searchParams, setSearchParams] = useSearchParams();
  const q: string = searchParams.get('q') || '';
  const navigate: NavigateFunction = useNavigate();
  const isMobile: boolean = useIsMobile();
  const [collapsed, setCollapsed] = useState<boolean>(isMobile);

  useEffect((): void => {
    setCollapsed(isMobile);
  }, [isMobile]);

  const filters: DiagramFilters = useMemo(
    (): DiagramFilters => ({ search: q, sort: 'updated_at', order: 'desc', limit: 50, offset: 0 }),
    [q],
  );

  const diagramsQuery = useDiagrams(filters);
  const diagramQuery = useDiagram(slug);

  const diagrams: DiagramSummary[] = diagramsQuery.data?.ok ? diagramsQuery.data.data : [];
  const selectedDiagram = diagramQuery.data?.ok ? diagramQuery.data.data : undefined;
  const latestDiagram: DiagramSummary | undefined = diagrams[0];
  const total: number = diagramsQuery.data?.ok && diagramsQuery.data.meta ? diagramsQuery.data.meta.total : 0;
  const hasAnyDiagrams: boolean = total > 0 || diagrams.length > 0;
  const notFound: boolean = isApiClientError(diagramQuery.error) && diagramQuery.error.status === 404;

  return (
    <div className={`layout${collapsed ? ' sidebar-collapsed' : ''}`}>
      {collapsed ? (
        <button
          type="button"
          className="sidebar-toggle-float"
          onClick={(): void => setCollapsed(false)}
          aria-label="Open sidebar"
        >☰</button>
      ) : null}
      {!collapsed && isMobile ? (
        <div
          className="sidebar-backdrop"
          onClick={(): void => setCollapsed(true)}
          role="presentation"
        />
      ) : null}
      <Sidebar
        diagrams={diagrams}
        query={q}
        collapsed={collapsed}
        onToggle={(): void => setCollapsed((value: boolean): boolean => !value)}
        onSearch={(value: string): void => {
          const next: URLSearchParams = new URLSearchParams(searchParams);
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
        {notFound ? <ErrorState message="Diagram not found." source="" /> : null}
        {!notFound ? (
          <DiagramViewer
            slug={slug}
            diagram={selectedDiagram}
            isLoading={diagramQuery.isLoading}
            error={diagramQuery.error}
          />
        ) : null}
        {!slug && latestDiagram ? (
          <button
            type="button"
            className="open-latest"
            onClick={(): void => { void navigate(`/d/${latestDiagram.slug}${q ? `?q=${encodeURIComponent(q)}` : ''}`); }}
          >
            Open latest diagram
          </button>
        ) : null}
      </main>
    </div>
  );
}
