export type DiagramType = 'mermaid';

export interface DiagramRecord {
  id: number;
  workspace_id: string;
  slug: string;
  title: string;
  description: string;
  content: string;
  diagram_type: DiagramType;
  tags: string[];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface DiagramSummary {
  id: number;
  workspace_id: string;
  slug: string;
  title: string;
  description: string;
  diagram_type: DiagramType;
  tags: string[];
  version: number;
  created_at: string;
  updated_at: string;
}
