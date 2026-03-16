export interface Diagram {
  id: number;
  slug: string;
  title: string;
  description: string;
  content: string;
  diagram_type: 'mermaid';
  tags: string[];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface DiagramSummary {
  id: number;
  slug: string;
  title: string;
  description: string;
  diagram_type: 'mermaid';
  tags: string[];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ListMeta {
  total: number;
  limit: number;
  offset: number;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  status: number;
  requestId: string;
}

export interface ApiSuccess<TData> {
  ok: true;
  data: TData;
  meta?: ListMeta;
}

export interface ApiFailure {
  ok: false;
  error: ApiErrorPayload;
}

export type ApiResponse<TData> = ApiSuccess<TData> | ApiFailure;

export interface DiagramFilters {
  search?: string;
  tags?: string;
  sort: 'updated_at' | 'created_at' | 'title';
  order: 'asc' | 'desc';
  limit: number;
  offset: number;
}

export interface ApiClientError {
  message: string;
  code: string;
  status: number;
}
