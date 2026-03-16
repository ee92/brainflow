import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import panzoom from 'panzoom';
import { ErrorState } from './ErrorState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { Toolbar } from './Toolbar';

let mermaidLoader;

async function getMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'strict',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        flowchart: { useMaxWidth: true },
        c4: { useMaxWidth: true },
      });
      return mermaid;
    });
  }
  return mermaidLoader;
}

/**
 * Parse "click <nodeId> <url> <tooltip>" directives from Mermaid source.
 * These get stripped by securityLevel:strict, so we handle them ourselves.
 */
function parseClickDirectives(content) {
  const links = {};
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.trim().match(/^click\s+(\S+)\s+"([^"]+)"(?:\s+"([^"]+)")?/);
    if (match) {
      links[match[1]] = { url: match[2], tooltip: match[3] || '' };
    }
  }
  return links;
}

/**
 * Strip click directives from source before rendering (they cause errors with strict security).
 */
function stripClickDirectives(content) {
  return content
    .split('\n')
    .filter((line) => !line.trim().match(/^click\s+/))
    .join('\n');
}

/**
 * After Mermaid renders the SVG, find nodes by ID and attach click overlays.
 * Mermaid generates nodes with IDs like "flowchart-<nodeId>-<n>" or just the nodeId in the element.
 */
function attachClickHandlers(container, clickLinks, navigate) {
  try {
    if (!container || Object.keys(clickLinks).length === 0) return;

    const svg = container.querySelector('svg');
    if (!svg) return;

    // Find all node groups in the SVG
    const nodeGroups = svg.querySelectorAll('.node');

    for (const group of nodeGroups) {
      const groupId = group.getAttribute('id') || '';
      const groupDataId = group.getAttribute('data-id') || '';
      const nestedDataId = group.querySelector('[data-id]')?.getAttribute('data-id') || '';
      const labelText = (group.querySelector('.nodeLabel, .label, text')?.textContent || '').trim();

      // Match against our click directives
      for (const [nodeId, linkInfo] of Object.entries(clickLinks)) {
        if (
          groupId.includes(nodeId) ||
          groupId === nodeId ||
          groupDataId === nodeId ||
          nestedDataId === nodeId ||
          labelText === nodeId
        ) {
          // Style the node as clickable
          group.style.cursor = 'pointer';

          // Add a subtle highlight border
          const shapes = group.querySelectorAll('rect, circle, polygon, path.basic, .label-container');
          for (const shape of shapes) {
            shape.style.strokeWidth = '3px';
            shape.style.filter = 'drop-shadow(0 0 4px rgba(79, 195, 247, 0.4))';
          }

          // Add a small link icon indicator
          const bbox = group.getBBox();
          const indicator = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          indicator.setAttribute('x', bbox.x + bbox.width - 8);
          indicator.setAttribute('y', bbox.y + 14);
          indicator.setAttribute('font-size', '12');
          indicator.setAttribute('fill', '#4fc3f7');
          indicator.textContent = '🔗';
          group.appendChild(indicator);

          // Add tooltip
          if (linkInfo.tooltip) {
            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = linkInfo.tooltip;
            group.prepend(title);
          }

          let mouseDownPos = null;
          let mouseMoved = false;

          group.addEventListener('mousedown', (e) => {
            mouseDownPos = { x: e.clientX, y: e.clientY };
            mouseMoved = false;
          });

          group.addEventListener('mousemove', (e) => {
            if (!mouseDownPos) return;
            const dx = Math.abs(e.clientX - mouseDownPos.x);
            const dy = Math.abs(e.clientY - mouseDownPos.y);
            if (dx > 3 || dy > 3) {
              mouseMoved = true;
            }
          });

          group.addEventListener('mouseup', (e) => {
            if (mouseMoved) {
              mouseDownPos = null;
              return;
            }

            e.preventDefault();
            e.stopPropagation();
            mouseDownPos = null;

            const url = linkInfo.url;
            if (url.startsWith('/d/') || url.startsWith('/')) {
              navigate(url);
            } else {
              window.open(url, '_blank');
            }
          });

          break;
        }
      }
    }
  } catch (error) {
    console.error('Failed to attach diagram click handlers', error);
  }
}

export function DiagramViewer({ diagram, isLoading, error }) {
  const viewerRef = useRef(null);
  const canvasRef = useRef(null);
  const panzoomRef = useRef(null);
  const [renderError, setRenderError] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  const fitToScreen = useCallback(() => {
    const pz = panzoomRef.current;
    const root = viewerRef.current;
    const canvas = canvasRef.current;
    if (!pz || !root || !canvas) {
      return;
    }

    const content = canvas.querySelector('svg');
    if (!content) {
      return;
    }

    const bounds = root.getBoundingClientRect();
    const box = content.getBBox();
    if (!box.width || !box.height) {
      return;
    }

    const scaleX = (bounds.width - 40) / box.width;
    const scaleY = (bounds.height - 80) / box.height;
    const scale = Math.max(0.2, Math.min(scaleX, scaleY, 2));

    pz.moveTo(20, 40);
    pz.zoomAbs(0, 0, scale);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      if (!diagram?.content || !canvasRef.current) {
        return;
      }

      setRenderError(null);
      canvasRef.current.innerHTML = '';

      try {
        const mermaid = await getMermaid();
        const id = `diagram-${diagram.id}-${Date.now()}`;

        // Parse click directives before stripping them
        const clickLinks = parseClickDirectives(diagram.content);
        const cleanContent = stripClickDirectives(diagram.content);

        const { svg } = await mermaid.render(id, cleanContent);

        if (cancelled) {
          return;
        }

        canvasRef.current.innerHTML = svg;

        // Attach click handlers to linked nodes
        attachClickHandlers(canvasRef.current, clickLinks, navigate);

        panzoomRef.current?.dispose?.();
        panzoomRef.current = panzoom(canvasRef.current, {
          maxZoom: 5,
          minZoom: 0.2,
          smoothScroll: false,
        });

        fitToScreen();
      } catch (err) {
        if (!cancelled) {
          setRenderError(err.message || 'Failed to render Mermaid diagram');
        }
      }
    }

    render();

    return () => {
      cancelled = true;
    };
  }, [diagram?.content, navigate, fitToScreen]);

  useEffect(() => () => panzoomRef.current?.dispose?.(), []);

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return <ErrorState message={error.message || 'Failed to load diagram'} source={diagram?.content} />;
  }

  if (!diagram) {
    return null;
  }

  if (renderError) {
    return <ErrorState message={renderError} source={diagram.content} />;
  }

  return (
    <section className="viewer-shell" ref={viewerRef}>
      <Toolbar
        onZoomIn={() => panzoomRef.current?.smoothZoom?.(0, 0, 1.2)}
        onZoomOut={() => panzoomRef.current?.smoothZoom?.(0, 0, 0.8)}
        onFit={fitToScreen}
        onCopy={async () => {
          await navigator.clipboard.writeText(diagram.content);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        onToggleRaw={() => setShowRaw((v) => !v)}
        onFullscreen={() => viewerRef.current?.requestFullscreen?.()}
        onToggleTheme={() => {
          const current = document.documentElement.getAttribute('data-theme') || 'dark';
          const next = current === 'dark' ? 'light' : 'dark';
          document.documentElement.setAttribute('data-theme', next);
          localStorage.setItem('draw-theme', next);
        }}
      />
      {copied ? <div className="copy-toast">Copied!</div> : null}
      <div className="diagram-canvas" ref={canvasRef} />
      {showRaw ? <pre className="raw-source">{diagram.content}</pre> : null}
    </section>
  );
}
