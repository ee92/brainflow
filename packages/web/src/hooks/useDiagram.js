import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { diagramKeys } from './useDiagrams';

export function useDiagram(slug) {
  return useQuery({
    queryKey: diagramKeys.detail(slug),
    queryFn: () => api.getDiagram(slug),
    enabled: !!slug,
  });
}
