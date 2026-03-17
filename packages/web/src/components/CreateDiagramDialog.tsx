import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { api, isApiClientError } from '../api/client';
import { diagramKeys } from '../hooks/useDiagrams';
import type { Diagram } from '../types/models';

interface CreateDiagramDialogProps {
  open: boolean;
  onClose: () => void;
}

const STARTER_TEMPLATE = 'graph TD\n    A[Start] --> B[End]';

export function CreateDiagramDialog({ open, onClose }: CreateDiagramDialogProps): JSX.Element | null {
  const queryClient = useQueryClient();
  const navigate: NavigateFunction = useNavigate();
  const [title, setTitle] = useState<string>('');
  const [slug, setSlug] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [tags, setTags] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect((): void => {
    if (!open) {
      return;
    }

    setTitle('');
    setSlug('');
    setDescription('');
    setTags('');
    setError(null);
    setSubmitting(false);
  }, [open]);

  if (!open) {
    return null;
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const nextTitle: string = title.trim();
    if (!nextTitle) {
      setError('Title is required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const parsedTags: string[] = tags
      .split(',')
      .map((tag: string): string => tag.trim())
      .filter((tag: string): boolean => tag.length > 0);

    try {
      const payload: Pick<Diagram, 'title' | 'content'> & Partial<Pick<Diagram, 'slug' | 'description' | 'tags'>> = {
        title: nextTitle,
        content: STARTER_TEMPLATE,
      };

      const nextSlug: string = slug.trim();
      const nextDescription: string = description.trim();

      if (nextSlug) {
        payload.slug = nextSlug;
      }
      if (nextDescription) {
        payload.description = nextDescription;
      }
      if (parsedTags.length > 0) {
        payload.tags = parsedTags;
      }

      const response = await api.createDiagram(payload);
      if (!response.ok) {
        throw new Error('Failed to create diagram');
      }

      await queryClient.invalidateQueries({ queryKey: diagramKeys.all });
      onClose();
      void navigate(`/d/${response.data.slug}`);
    } catch (submitError: unknown) {
      if (isApiClientError(submitError)) {
        setError(submitError.message);
      } else if (submitError instanceof Error) {
        setError(submitError.message);
      } else {
        setError('Failed to create diagram');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="dialog-panel" role="dialog" aria-modal="true" aria-label="Create diagram" onClick={(event): void => event.stopPropagation()}>
        <h2>Create Diagram</h2>
        <form onSubmit={(event): void => { void onSubmit(event); }} className="dialog-form">
          <label htmlFor="diagram-title">Title</label>
          <input
            id="diagram-title"
            type="text"
            value={title}
            onChange={(event): void => setTitle(event.target.value)}
            required
            autoFocus
          />

          <label htmlFor="diagram-slug">Slug (optional)</label>
          <input
            id="diagram-slug"
            type="text"
            value={slug}
            onChange={(event): void => setSlug(event.target.value)}
            placeholder="my-diagram"
          />

          <label htmlFor="diagram-description">Description (optional)</label>
          <textarea
            id="diagram-description"
            value={description}
            onChange={(event): void => setDescription(event.target.value)}
            rows={2}
          />

          <label htmlFor="diagram-tags">Tags (comma-separated, optional)</label>
          <input
            id="diagram-tags"
            type="text"
            value={tags}
            onChange={(event): void => setTags(event.target.value)}
            placeholder="architecture, onboarding"
          />

          <label htmlFor="diagram-template">Starter Template</label>
          <pre id="diagram-template" className="dialog-template">{STARTER_TEMPLATE}</pre>

          {error ? <div className="dialog-error">{error}</div> : null}

          <div className="dialog-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={submitting}>{submitting ? 'Creating...' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
