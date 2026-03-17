interface ToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onCopy: () => Promise<void>;
  onToggleRaw: () => void;
  onEdit: () => void;
  onNew: () => void;
  onFullscreen: () => void;
  onToggleTheme: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function Toolbar({
  onZoomIn, onZoomOut, onFit, onCopy, onToggleRaw, onEdit, onNew, onFullscreen, onToggleTheme,
  sidebarCollapsed, onToggleSidebar,
}: ToolbarProps): JSX.Element {
  return (
    <div className="toolbar">
      {sidebarCollapsed ? (
        <button type="button" className="sidebar-toggle-inline" onClick={onToggleSidebar} aria-label="Open sidebar">☰</button>
      ) : null}
      <button type="button" aria-label="Zoom In" onClick={onZoomIn}>+</button>
      <button type="button" aria-label="Zoom Out" onClick={onZoomOut}>−</button>
      <button type="button" aria-label="Fit to Screen" onClick={onFit}>Fit</button>
      <button type="button" aria-label="Copy Source" onClick={(): void => { void onCopy(); }}>Copy</button>
      <button type="button" aria-label="Toggle Raw" onClick={onToggleRaw}>Raw</button>
      <button type="button" aria-label="Edit Diagram" onClick={onEdit}>Edit</button>
      <button type="button" aria-label="New Diagram" onClick={onNew}>New</button>
      <button type="button" aria-label="Fullscreen" onClick={onFullscreen}>⛶</button>
      <button type="button" aria-label="Toggle Theme" onClick={onToggleTheme}>◐</button>
    </div>
  );
}
