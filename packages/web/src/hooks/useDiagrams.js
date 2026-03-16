import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

export const diagramKeys = {
  all: ['diagrams'],
  list: (filters) => ['diagrams', 'list', filters],
  detail: (slug) => ['diagrams', 'detail', slug],
};

export function useDiagrams(filters) {
  return useQuery({
    queryKey: diagramKeys.list(filters),
    queryFn: () => api.listDiagrams(filters),
  });
}
