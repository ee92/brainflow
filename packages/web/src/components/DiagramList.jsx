import { Link, useParams } from 'react-router-dom';

function relativeTime(isoTime) {
  const seconds = Math.floor((Date.now() - new Date(isoTime).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function DiagramList({ diagrams = [], query = '' }) {
  const { slug } = useParams();

  return (
    <ul className="diagram-list">
      {diagrams.map((diagram) => {
        const active = diagram.slug === slug;
        return (
          <li key={diagram.id} className={active ? 'active' : ''}>
            <Link to={`/d/${diagram.slug}${query ? `?q=${encodeURIComponent(query)}` : ''}`}>
              <h4>{diagram.title}</h4>
              <div className="tags">
                {diagram.tags.map((tag) => (
                  <span key={tag} className="tag-pill">{tag}</span>
                ))}
              </div>
              <small>{relativeTime(diagram.updated_at)}</small>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
