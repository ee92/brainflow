import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import panzoom, { type PanZoomController } from 'panzoom';
import type { ApiClientError, Diagram } from '../types/models';
import { ErrorState } from './ErrorState';
import { LoadingSkeleton } from './LoadingSkeleton';
import { Toolbar } from './Toolbar';

interface MermaidApi {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, definition: string) => Promise<{ svg: string }>;
}

interface MermaidModule {
  default: MermaidApi;
}

interface ClickLink {
  url: string;
  tooltip: string;
}

type ClickLinks = Record<string, ClickLink>;

interface DiagramViewerProps {
  diagram?: Diagram;
  isLoading: boolean;
  error: Error | ApiClientError | null;
}

let mermaidLoader: Promise<MermaidApi> | undefined;

function isErrorWithMessage(error: unknown): error is { message: string } {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  if (!('message' in error)) {
    return false;
  }

  return typeof error.message === 'string';
}

async function getMermaid(): Promise<MermaidApi> {
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then((mod: MermaidModule): MermaidApi => {
      const mermaid: MermaidApi = mod.default;
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

function parseClickDirectives(content: string): ClickLinks {
  const links: ClickLinks = {};
  const lines: string[] = content.split('\n');
  for (const line of lines) {
    const match: RegExpMatchArray | null = line.trim().match(/^click\s+(\S+)\s+"([^"]+)"(?:\s+"([^"]+)")?/);
    if (match) {
      links[match[1]] = { url: match[2], tooltip: match[3] || '' };
    }
  }

  return links;
}

function stripClickDirectives(content: string): string {
  return content
    .split('\n')
    .filter((line: string): boolean => !line.trim().match(/^click\s+/))
    .join('\n');
}

function attachClickHandlers(container: HTMLDivElement, clickLinks: ClickLinks, navigate: NavigateFunction): void {
  try {
    if (Object.keys(clickLinks).length === 0) {
      return;
    }

    const svg: SVGSVGElement | null = container.querySelector('svg');
    if (!svg) {
      return;
    }

    const nodeGroups: NodeListOf<SVGGElement> = svg.querySelectorAll('.node');

    for (const group of nodeGroups) {
      const groupId: string = group.getAttribute('id') || '';
      const groupDataId: string = group.getAttribute('data-id') || '';
      const nestedDataId: string = group.querySelector('[data-id]')?.getAttribute('data-id') || '';
      const labelText: string = (group.querySelector('.nodeLabel, .label, text')?.textContent || '').trim();

      for (const [nodeId, linkInfo] of Object.entries(clickLinks)) {
        const matches: boolean = (
          groupId.includes(nodeId)
          || groupId === nodeId
          || groupDataId === nodeId
          || nestedDataId === nodeId
          || labelText === nodeId
        );

        if (!matches) {
          continue;
        }

        group.style.cursor = 'pointer';

        const shapes: NodeListOf<SVGElement> = group.querySelectorAll('rect, circle, polygon, path.basic, .label-container');
        for (const shape of shapes) {
          shape.style.strokeWidth = '3px';
          shape.style.filter = 'drop-shadow(0 0 4px rgba(79, 195, 247, 0.4))';
        }

        const bbox: DOMRect = group.getBBox();
        const indicator: SVGTextElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        indicator.setAttribute('x', String(bbox.x + bbox.width - 8));
        indicator.setAttribute('y', String(bbox.y + 14));
        indicator.setAttribute('font-size', '12');
        indicator.setAttribute('fill', '#4fc3f7');
        indicator.textContent = '🔗';
        group.appendChild(indicator);

        if (linkInfo.tooltip) {
          const title: SVGTitleElement = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          title.textContent = linkInfo.tooltip;
          group.prepend(title);
        }

        let mouseDownPos: { x: number; y: number } | null = null;
        let mouseMoved = false;

        group.addEventListener('mousedown', (event: MouseEvent): void => {
          mouseDownPos = { x: event.clientX, y: event.clientY };
          mouseMoved = false;
        });

        group.addEventListener('mousemove', (event: MouseEvent): void => {
          if (!mouseDownPos) {
            return;
          }

          const dx: number = Math.abs(event.clientX - mouseDownPos.x);
          const dy: number = Math.abs(event.clientY - mouseDownPos.y);
          if (dx > 3 || dy > 3) {
            mouseMoved = true;
          }
        });

        group.addEventListener('mouseup', (event: MouseEvent): void => {
          if (mouseMoved) {
            mouseDownPos = null;
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          mouseDownPos = null;

          if (linkInfo.url.startsWith('/d/') || linkInfo.url.startsWith('/')) {
            navigate(linkInfo.url);
            return;
          }

          window.open(linkInfo.url, '_blank');
        });

        break;
      }
    }
  } catch (error: unknown) {
    console.error('Failed to attach diagram click handlers', error);
  }
}

export function DiagramViewer({ diagram, isLoading, error }: DiagramViewerProps): JSX.Element | null {
  const viewerRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const panzoomRef = useRef<PanZoomController | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const navigate: NavigateFunction = useNavigate();

  const fitToScreen = useCallback((): void => {
    const pz: PanZoomController | null = panzoomRef.current;
    const root: HTMLElement | null = viewerRef.current;
    const canvas: HTMLDivElement | null = canvasRef.current;
    if (!pz || !root || !canvas) {
      return;
    }

    const content: SVGGraphicsElement | null = canvas.querySelector('svg');
    if (!content) {
      return;
    }

    const bounds: DOMRect = root.getBoundingClientRect();
    const box: DOMRect = content.getBBox();
    if (!box.width || !box.height) {
      return;
    }

    const scaleX: number = (bounds.width - 40) / box.width;
    const scaleY: number = (bounds.height - 80) / box.height;
    const scale: number = Math.max(0.2, Math.min(scaleX, scaleY, 2));

    pz.moveTo(20, 40);
    pz.zoomAbs(0, 0, scale);
  }, []);

  useEffect((): (() => void) => {
    let cancelled = false;

    const render = async (): Promise<void> => {
      if (!diagram?.content || !canvasRef.current) {
        return;
      }

      setRenderError(null);
      canvasRef.current.innerHTML = '';

      try {
        const mermaid: MermaidApi = await getMermaid();
        const id: string = `diagram-${diagram.id}-${Date.now()}`;

        const clickLinks: ClickLinks = parseClickDirectives(diagram.content);
        const cleanContent: string = stripClickDirectives(diagram.content);

        const rendered = await mermaid.render(id, cleanContent);

        if (cancelled || !canvasRef.current) {
          return;
        }

        canvasRef.current.innerHTML = rendered.svg;
        attachClickHandlers(canvasRef.current, clickLinks, navigate);

        if (panzoomRef.current) {
          panzoomRef.current.dispose();
        }

        panzoomRef.current = panzoom(canvasRef.current, {
          maxZoom: 5,
          minZoom: 0.2,
          smoothScroll: false,
        });

        fitToScreen();
      } catch (renderFailure: unknown) {
        if (!cancelled) {
          if (isErrorWithMessage(renderFailure)) {
            setRenderError(renderFailure.message || 'Failed to render Mermaid diagram');
          } else {
            setRenderError('Failed to render Mermaid diagram');
          }
        }
      }
    };

    void render();

    return (): void => {
      cancelled = true;
    };
  }, [diagram, navigate, fitToScreen]);

  useEffect((): (() => void) => {
    return (): void => {
      if (panzoomRef.current) {
        panzoomRef.current.dispose();
      }
    };
  }, []);

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return <ErrorState message={error.message || 'Failed to load diagram'} source={diagram?.content || ''} />;
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
        onZoomIn={(): void => {
          if (panzoomRef.current) {
            panzoomRef.current.smoothZoom(0, 0, 1.2);
          }
        }}
        onZoomOut={(): void => {
          if (panzoomRef.current) {
            panzoomRef.current.smoothZoom(0, 0, 0.8);
          }
        }}
        onFit={fitToScreen}
        onCopy={async (): Promise<void> => {
          await navigator.clipboard.writeText(diagram.content);
          setCopied(true);
          setTimeout((): void => setCopied(false), 2000);
        }}
        onToggleRaw={(): void => setShowRaw((value: boolean): boolean => !value)}
        onFullscreen={(): void => {
          if (viewerRef.current?.requestFullscreen) {
            void viewerRef.current.requestFullscreen();
          }
        }}
        onToggleTheme={(): void => {
          const current: string = document.documentElement.getAttribute('data-theme') || 'dark';
          const next: string = current === 'dark' ? 'light' : 'dark';
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
