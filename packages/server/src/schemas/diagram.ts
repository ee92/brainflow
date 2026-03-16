import { z } from 'zod';

const tagSchema = z.string().max(100).regex(/^[a-zA-Z0-9-]+$/);

export const slugParamSchema = z.object({
  slug: z.string().min(1).max(255).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
}).strict();

export const createDiagramSchema = z.object({
  title: z.string().min(1).max(500),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).optional(),
  description: z.string().max(10000).optional().default(''),
  content: z.string().min(1).max(512000),
  diagram_type: z.enum(['mermaid']).optional().default('mermaid'),
  tags: z.array(tagSchema).max(20).optional().default([]),
}).strict();

export const updateDiagramSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional(),
  content: z.string().min(1).max(512000).optional(),
  tags: z.array(tagSchema).max(20).optional(),
  version: z.number().int().min(1),
}).strict();

export const deleteDiagramSchema = z.object({
  version: z.number().int().min(1),
}).strict();

export const listDiagramsSchema = z.object({
  search: z.string().max(200).optional(),
  tags: z.string().max(500).optional(),
  sort: z.enum(['updated_at', 'created_at', 'title']).optional().default('updated_at'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
}).strict();

export type SlugParams = z.infer<typeof slugParamSchema>;
export type CreateDiagramInput = z.infer<typeof createDiagramSchema>;
export type UpdateDiagramInput = z.infer<typeof updateDiagramSchema>;
export type DeleteDiagramInput = z.infer<typeof deleteDiagramSchema>;
export type ListDiagramsInput = z.infer<typeof listDiagramsSchema>;
