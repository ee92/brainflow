export interface MermaidApi {
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

export type ClickLinks = Record<string, ClickLink>;

let mermaidLoader: Promise<MermaidApi> | undefined;

export async function getMermaid(): Promise<MermaidApi> {
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

export function parseClickDirectives(content: string): ClickLinks {
  const links: ClickLinks = {};
  const lines: string[] = content.split('\n');

  for (const line of lines) {
    const match: RegExpMatchArray | null = line.trim().match(/^click\s+(\S+)\s+"([^"]+)"(?:\s+"([^"]+)")?/);
    if (match) {
      const nodeId: string | undefined = match[1];
      const url: string | undefined = match[2];
      if (nodeId && url) {
        links[nodeId] = { url, tooltip: match[3] || '' };
      }
    }
  }

  return links;
}

export function stripClickDirectives(content: string): string {
  return content
    .split('\n')
    .filter((line: string): boolean => !line.trim().match(/^click\s+/))
    .join('\n');
}

export async function renderMermaidSvg(content: string, id: string): Promise<string> {
  const mermaid: MermaidApi = await getMermaid();
  const rendered = await mermaid.render(id, stripClickDirectives(content));
  return rendered.svg;
}
