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
        <div className="sidebar-brand">
          <span className="brand-logo">🧠</span>
          <span className="brand-name">Brainflow</span>
        </div>
        <button type="button" className="sidebar-close" onClick={onToggle} aria-label="Close sidebar">✕</button>
      </div>
      <SearchBar value={query} onSearch={onSearch} />
      <DiagramList diagrams={diagrams} query={query} />
    </aside>
  );
}
