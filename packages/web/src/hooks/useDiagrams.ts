import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ApiResponse, DiagramFilters, DiagramSummary } from '../types/models';

interface DiagramKeys {
  all: readonly string[];
  list: (filters: Partial<DiagramFilters>) => readonly [string, string, Partial<DiagramFilters>];
  detail: (slug: string) => readonly [string, string, string];
}

export const diagramKeys: DiagramKeys = {
  all: ['diagrams'],
  list: (filters: Partial<DiagramFilters>): readonly [string, string, Partial<DiagramFilters>] => ['diagrams', 'list', filters],
  detail: (slug: string): readonly [string, string, string] => ['diagrams', 'detail', slug],
};

export function useDiagrams(filters: Partial<DiagramFilters>): UseQueryResult<ApiResponse<DiagramSummary[]>, Error> {
  return useQuery({
    queryKey: diagramKeys.list(filters),
    queryFn: (): Promise<ApiResponse<DiagramSummary[]>> => api.listDiagrams(filters),
  });
}
