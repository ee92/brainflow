import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup } from '@codemirror/basic-setup';
import { api, isApiClientError } from '../api/client';
import { diagramKeys } from '../hooks/useDiagrams';
import type { Diagram } from '../types/models';
import { renderMermaidSvg } from '../utils/mermaid';

interface SourceEditorProps {
  diagram: Diagram;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onCancel: () => void;
  onSaved: (diagram: Diagram) => void;
}

export function SourceEditor({ diagram, sidebarCollapsed, onToggleSidebar, onCancel, onSaved }: SourceEditorProps): JSX.Element {
  const queryClient = useQueryClient();
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const [title, setTitle] = useState<string>(diagram.title);
  const [content, setContent] = useState<string>(diagram.content);
  const [previewContent, setPreviewContent] = useState<string>(diagram.content);
  const [previewSvg, setPreviewSvg] = useState<string>('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  const hasChanges: boolean = useMemo(
    (): boolean => title.trim() !== diagram.title || content !== diagram.content,
    [content, diagram.content, diagram.title, title],
  );

  useEffect((): void => {
    setTitle(diagram.title);
    setContent(diagram.content);
    setPreviewContent(diagram.content);
    setSaveError(null);
    const view: EditorView | null = editorViewRef.current;
    if (!view) {
      return;
    }

    const current: string = view.state.doc.toString();
    if (current === diagram.content) {
      return;
    }

    view.dispatch({
      changes: { from: 0, to: current.length, insert: diagram.content },
    });
  }, [diagram.content, diagram.title]);

  useEffect((): (() => void) | void => {
    if (!editorHostRef.current) {
      return;
    }

    const state: EditorState = EditorState.create({
      doc: diagram.content,
      extensions: [
        basicSetup,
        markdown(),
        oneDark,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update): void => {
          if (update.docChanged) {
            setContent(update.state.doc.toString());
          }
        }),
      ],
    });

    const view: EditorView = new EditorView({
      state,
      parent: editorHostRef.current,
    });

    editorViewRef.current = view;

    return (): void => {
      view.destroy();
      editorViewRef.current = null;
    };
  }, [diagram.id, diagram.content]);

  useEffect((): (() => void) => {
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      setPreviewContent(content);
    }, 500);

    return (): void => clearTimeout(timer);
  }, [content]);

  useEffect((): (() => void) => {
    let cancelled = false;

    const render = async (): Promise<void> => {
      setRenderError(null);

      try {
        const svg: string = await renderMermaidSvg(previewContent, `editor-preview-${diagram.id}-${Date.now()}`);
        if (!cancelled) {
          setPreviewSvg(svg);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          if (error instanceof Error) {
            setRenderError(error.message || 'Failed to render Mermaid diagram');
          } else {
            setRenderError('Failed to render Mermaid diagram');
          }
        }
      }
    };

    void render();

    return (): void => {
      cancelled = true;
    };
  }, [diagram.id, previewContent]);

  const onSave = async (): Promise<void> => {
    const nextTitle: string = title.trim();
    if (!nextTitle) {
      setSaveError('Title is required.');
      return;
    }

    if (!hasChanges) {
      onCancel();
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const response = await api.updateDiagram(diagram.slug, {
        title: nextTitle,
        content,
        version: diagram.version,
      });
      if (!response.ok) {
        throw new Error('Failed to save diagram');
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: diagramKeys.detail(diagram.slug) }),
        queryClient.invalidateQueries({ queryKey: diagramKeys.all }),
      ]);

      onSaved(response.data);
    } catch (error: unknown) {
      if (isApiClientError(error)) {
        setSaveError(error.message);
      } else if (error instanceof Error) {
        setSaveError(error.message);
      } else {
        setSaveError('Failed to save diagram');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="source-editor-shell">
      <header className="source-editor-toolbar">
        {sidebarCollapsed ? (
          <button type="button" className="sidebar-toggle-inline" onClick={onToggleSidebar} aria-label="Open sidebar">☰</button>
        ) : null}
        <input
          type="text"
          value={title}
          onChange={(event): void => setTitle(event.target.value)}
          className="source-editor-title"
          placeholder="Diagram title"
          aria-label="Diagram title"
        />
        <div className="source-editor-actions">
          <button type="button" onClick={onCancel} className="editor-cancel">Cancel</button>
          <button type="button" onClick={(): void => { void onSave(); }} className="editor-save" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </header>
      {saveError ? <div className="source-editor-message error">{saveError}</div> : null}
      <div className="source-editor-split">
        <div className="source-editor-pane source-pane">
          <div ref={editorHostRef} className="source-editor-codemirror" />
        </div>
        <div className="source-editor-pane preview-pane">
          {renderError ? (
            <div className="source-editor-preview-error">{renderError}</div>
          ) : (
            <div className="source-editor-preview" dangerouslySetInnerHTML={{ __html: previewSvg }} />
          )}
        </div>
      </div>
    </section>
  );
}
