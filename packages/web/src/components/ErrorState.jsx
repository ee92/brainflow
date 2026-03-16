export function ErrorState({ message, source }) {
  return (
    <div className="error-state" role="alert">
      <h3>Error</h3>
      <p>{message}</p>
      {source ? <pre>{source}</pre> : null}
    </div>
  );
}
