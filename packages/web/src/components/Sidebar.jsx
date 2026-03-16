import { DiagramList } from './DiagramList';
import { SearchBar } from './SearchBar';

export function Sidebar({ diagrams, query, onSearch, collapsed, onToggle }) {
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
