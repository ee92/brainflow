import { useEffect, useState } from 'react';

export function SearchBar({ value = '', onSearch }) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => onSearch(draft), 300);
    return () => clearTimeout(timer);
  }, [draft, onSearch]);

  return (
    <div className="search-bar">
      <span aria-hidden="true" className="search-icon">🔎</span>
      <input
        aria-label="Search diagrams"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Search diagrams"
      />
      {draft ? (
        <button type="button" aria-label="Clear search" onClick={() => setDraft('')}>
          Clear
        </button>
      ) : null}
    </div>
  );
}
