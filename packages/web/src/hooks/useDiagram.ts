import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from '../api/client';
import { diagramKeys } from './useDiagrams';
import type { ApiResponse, Diagram } from '../types/models';

export function useDiagram(slug: string): UseQueryResult<ApiResponse<Diagram>, Error> {
  return useQuery({
    queryKey: diagramKeys.detail(slug),
    queryFn: (): Promise<ApiResponse<Diagram>> => api.getDiagram(slug),
    enabled: slug.length > 0,
  });
}
