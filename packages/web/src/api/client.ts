import type {
  ApiClientError,
  ApiResponse,
  Diagram,
  DiagramFilters,
  DiagramSummary,
} from '../types/models';

const BASE = '/api/v1';

class HttpClientError extends Error implements ApiClientError {
  public readonly code: string;
  public readonly status: number;

  public constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function cleanFilters(filters: Partial<DiagramFilters> = {}): string {
  const entries: Array<[string, string]> = [];

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    entries.push([key, String(value)]);
  }

  return new URLSearchParams(entries).toString();
}

async function request<TData>(path: string, options: RequestInit = {}): Promise<ApiResponse<TData>> {
  const response: Response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const body: ApiResponse<TData> = await response.json();
  if (!body.ok) {
    throw new HttpClientError(body.error.message || 'Unknown error', body.error.code || 'UNKNOWN', response.status);
  }

  return body;
}

export function isApiClientError(error: unknown): error is ApiClientError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  if (!('status' in error) || !('code' in error) || !('message' in error)) {
    return false;
  }

  return (
    typeof error.status === 'number'
    && typeof error.code === 'string'
    && typeof error.message === 'string'
  );
}

export const api = {
  listDiagrams: (filters: Partial<DiagramFilters> = {}): Promise<ApiResponse<DiagramSummary[]>> => {
    const query: string = cleanFilters(filters);
    const suffix: string = query.length > 0 ? `?${query}` : '';
    return request<DiagramSummary[]>(`/diagrams${suffix}`);
  },
  getDiagram: (slug: string): Promise<ApiResponse<Diagram>> => request<Diagram>(`/diagrams/${slug}`),
  createDiagram: (data: Pick<Diagram, 'title' | 'content'> & Partial<Pick<Diagram, 'slug' | 'description' | 'tags' | 'diagram_type'>>): Promise<ApiResponse<Diagram>> => request<Diagram>('/diagrams', { method: 'POST', body: JSON.stringify(data) }),
  updateDiagram: (slug: string, data: Partial<Pick<Diagram, 'title' | 'description' | 'content' | 'tags'>> & { version: number }): Promise<ApiResponse<Diagram>> => request<Diagram>(`/diagrams/${slug}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteDiagram: (slug: string, version: number): Promise<ApiResponse<Diagram>> => request<Diagram>(`/diagrams/${slug}`, { method: 'DELETE', body: JSON.stringify({ version }) }),
  restoreDiagram: (slug: string): Promise<ApiResponse<Diagram>> => request<Diagram>(`/diagrams/${slug}/restore`, { method: 'POST' }),
};
