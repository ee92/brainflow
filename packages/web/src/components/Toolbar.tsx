interface ToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onCopy: () => Promise<void>;
  onToggleRaw: () => void;
  onFullscreen: () => void;
  onToggleTheme: () => void;
}

export function Toolbar({ onZoomIn, onZoomOut, onFit, onCopy, onToggleRaw, onFullscreen, onToggleTheme }: ToolbarProps): JSX.Element {
  return (
    <div className="toolbar">
      <button type="button" aria-label="Zoom In" onClick={onZoomIn}>+</button>
      <button type="button" aria-label="Zoom Out" onClick={onZoomOut}>-</button>
      <button type="button" aria-label="Fit to Screen" onClick={onFit}>Fit</button>
      <button type="button" aria-label="Copy Source" onClick={(): void => { void onCopy(); }}>Copy Source</button>
      <button type="button" aria-label="Toggle Raw" onClick={onToggleRaw}>Toggle Raw</button>
      <button type="button" aria-label="Fullscreen" onClick={onFullscreen}>Fullscreen</button>
      <button type="button" aria-label="Toggle Theme" onClick={onToggleTheme}>Theme</button>
    </div>
  );
}
