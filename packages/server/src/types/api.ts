export interface ApiSuccess<TData> {
  ok: true;
  data: TData;
}

export interface ApiSuccessWithMeta<TData, TMeta> extends ApiSuccess<TData> {
  meta: TMeta;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  status: number;
  requestId: string;
}

export interface ApiErrorResponse {
  ok: false;
  error: ApiErrorPayload;
}

export interface ListMeta {
  total: number;
  limit: number;
  offset: number;
}
