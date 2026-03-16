import { useEffect, useState, type ChangeEvent } from 'react';

interface SearchBarProps {
  value?: string;
  onSearch: (value: string) => void;
}

export function SearchBar({ value = '', onSearch }: SearchBarProps): JSX.Element {
  const [draft, setDraft] = useState<string>(value);

  useEffect((): void => {
    setDraft(value);
  }, [value]);

  useEffect((): (() => void) => {
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => onSearch(draft), 300);
    return (): void => clearTimeout(timer);
  }, [draft, onSearch]);

  return (
    <div className="search-bar">
      <input
        aria-label="Search diagrams"
        value={draft}
        onChange={(event: ChangeEvent<HTMLInputElement>): void => setDraft(event.target.value)}
        placeholder="Search diagrams..."
      />
      {draft ? (
        <button type="button" className="search-clear" aria-label="Clear search" onClick={(): void => setDraft('')}>
          ✕
        </button>
      ) : null}
    </div>
  );
}
