export function LoadingSkeleton(): JSX.Element {
  return (
    <div className="loading-skeleton">
      <div className="skeleton-toolbar" />
      <div className="skeleton-canvas" />
      <div className="skeleton-raw" />
    </div>
  );
}
