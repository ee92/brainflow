import type { DiagramSummary } from '../types/models';
import { DiagramList } from './DiagramList';
import { SearchBar } from './SearchBar';

interface SidebarProps {
  diagrams: DiagramSummary[];
  query: string;
  onSearch: (value: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ diagrams, query, onSearch, collapsed, onToggle }: SidebarProps): JSX.Element {
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <button type="button" onClick={onToggle} aria-label="Toggle sidebar">☰</button>
      </div>
      <SearchBar value={query} onSearch={onSearch} />
      <DiagramList diagrams={diagrams} query={query} />
    </aside>
  );
}
