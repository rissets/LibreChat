import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@librechat/client';
import { ChevronDown, MessageSquarePlus, Save, Type } from 'lucide-react';
import { useSetRecoilState } from 'recoil';
import type { Artifact } from '~/common';
import { useEditArtifact } from '~/data-provider';
import {
  useArtifactsContext,
  useCodeState,
  useMutationState,
  useOptionalChatFormContext,
} from '~/Providers';
import { mainTextareaId } from '~/common';
import { useLocalize } from '~/hooks';
import store from '~/store';
import { buildArtifactAnnotationPrompt } from './artifactAnnotation';

type Selection = {
  selector: string;
  tag: string;
  text: string;
  color: string;
  backgroundColor: string;
  fontSize: string;
  display: string;
};

const EDITOR_SCRIPT = String.raw`
<script data-hellodigi-visual-editor>
(() => {
  const selectorFor = (element) => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += '#' + CSS.escape(current.id);
        parts.unshift(part);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const peers = Array.from(parent.children).filter((item) => item.tagName === current.tagName);
        if (peers.length > 1) part += ':nth-of-type(' + (peers.indexOf(current) + 1) + ')';
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(' > ');
  };

  let selected = null;
  const emit = (element) => {
    const style = getComputedStyle(element);
    parent.postMessage({
      type: 'hellodigi-artifact-selection',
      selection: {
        selector: selectorFor(element),
        tag: element.tagName.toLowerCase(),
        text: element.children.length === 0 ? (element.textContent || '').trim() : '',
        color: style.color,
        backgroundColor: style.backgroundColor,
        fontSize: style.fontSize,
        display: style.display,
      },
    }, '*');
  };

  document.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (selected) selected.style.removeProperty('outline');
    selected = event.target;
    selected.style.setProperty('outline', '3px solid Highlight', 'important');
    selected.style.setProperty('outline-offset', '2px', 'important');
    emit(selected);
  }, true);

  document.addEventListener('submit', (event) => event.preventDefault(), true);
})();
</script>`;

function injectEditor(source: string): string {
  const closingBodies = [...source.matchAll(/<\/body\s*>/gi)];
  const finalClosingBody = closingBodies.at(-1);
  if (finalClosingBody?.index != null) {
    return `${source.slice(0, finalClosingBody.index)}${EDITOR_SCRIPT}${source.slice(
      finalClosingBody.index,
    )}`;
  }

  // Generated artifacts may be truncated at the model/output boundary. If that
  // happens inside a raw-text element, simply appending the editor makes its
  // script part of the unfinished <script>/<style> and the editor never boots.
  // Close only unmatched raw-text elements, then finish a valid document shell.
  const count = (pattern: RegExp) => source.match(pattern)?.length ?? 0;
  const unclosedScripts = Math.max(0, count(/<script\b[^>]*>/gi) - count(/<\/script\s*>/gi));
  const unclosedStyles = Math.max(0, count(/<style\b[^>]*>/gi) - count(/<\/style\s*>/gi));
  const repaired = `${source}${'</script>'.repeat(unclosedScripts)}${'</style>'.repeat(
    unclosedStyles,
  )}`;

  return `${repaired}${EDITOR_SCRIPT}</body></html>`;
}

function serializeDocument(source: string, selection: Selection): string | null {
  const documentNode = new DOMParser().parseFromString(source, 'text/html');
  const element = documentNode.querySelector<HTMLElement>(selection.selector);
  if (!element) {
    return null;
  }

  if (element.children.length === 0) {
    element.textContent = selection.text;
  }
  element.style.color = selection.color;
  element.style.backgroundColor = selection.backgroundColor;
  element.style.fontSize = selection.fontSize;
  element.style.display = selection.display;

  return `<!doctype html>\n${documentNode.documentElement.outerHTML}`;
}

export default function ArtifactVisualEditor({
  artifact,
  readOnly = false,
}: {
  artifact: Artifact;
  readOnly?: boolean;
}) {
  const localize = useLocalize();
  const chatForm = useOptionalChatFormContext();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { isSubmitting } = useArtifactsContext();
  const { currentCode, setCurrentCode } = useCodeState();
  const { isMutating, setIsMutating } = useMutationState();
  const setArtifacts = useSetRecoilState(store.artifactsState);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const source = currentCode ?? artifact.content ?? '';
  const editable = !readOnly && !isSubmitting;
  const srcDoc = useMemo(() => injectEditor(source), [source]);

  const editArtifact = useEditArtifact({
    onMutate: () => {
      setSaveError(null);
      setIsMutating(true);
    },
    onSuccess: () => setIsMutating(false),
    onError: () => {
      setSaveError(localize('com_ui_artifact_save_error'));
      setIsMutating(false);
    },
  });

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }
      if (event.data?.type !== 'hellodigi-artifact-selection') {
        return;
      }
      const next = event.data.selection as Partial<Selection> | undefined;
      if (!next?.selector || !next.tag) {
        return;
      }
      setSelection({
        selector: String(next.selector),
        tag: String(next.tag),
        text: String(next.text ?? ''),
        color: String(next.color ?? ''),
        backgroundColor: String(next.backgroundColor ?? ''),
        fontSize: String(next.fontSize ?? ''),
        display: String(next.display ?? ''),
      });
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const applyChanges = () => {
    if (!selection || !editable || isMutating) {
      return;
    }
    const updated = serializeDocument(source, selection);
    if (!updated || updated.trim() === source.trim()) {
      return;
    }
    setCurrentCode(updated);
    setArtifacts((previous) => ({
      ...(previous ?? {}),
      [artifact.id]: { ...artifact, content: updated, lastUpdateTime: Date.now() },
    }));
    if (artifact.index == null || !artifact.messageId) {
      setSaveError(null);
      return;
    }
    editArtifact.mutate({
      index: artifact.index as number,
      messageId: artifact.messageId,
      original: source,
      updated,
    });
  };

  const addAnnotationToDraft = () => {
    if (!chatForm || !selection) {
      return;
    }
    const prompt = buildArtifactAnnotationPrompt(artifact, selection);
    const current = chatForm.getValues('text').trim();
    const value = current ? `${current}\n\n${prompt}` : prompt;
    chatForm.setValue('text', value, { shouldDirty: true, shouldValidate: true });
    requestAnimationFrame(() => {
      const textarea = document.getElementById(mainTextareaId) as HTMLTextAreaElement | null;
      textarea?.focus();
      textarea?.setSelectionRange(value.length, value.length);
    });
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface-secondary">
      <iframe
        ref={iframeRef}
        title={`${artifact.title ?? 'Artifact'} visual editor`}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        className="h-full w-full border-0 bg-surface-primary"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-surface-secondary/90 to-transparent p-3 text-text-primary">
        <div className="pointer-events-auto rounded-full bg-surface-primary/90 px-3 py-1.5 text-xs backdrop-blur">
          {localize('com_ui_artifact_editing_instruction')}
        </div>
        <div className="pointer-events-auto rounded-full bg-surface-primary/90 px-3 py-1.5 text-xs backdrop-blur">
          {editable
            ? localize('com_ui_artifact_editing_active')
            : localize('com_ui_artifact_preview_only')}
        </div>
      </div>

      {selection && (
        <aside className="absolute bottom-5 left-5 z-20 w-[min(360px,calc(100%-40px))] overflow-hidden rounded-3xl border border-border-light bg-surface-primary/95 text-sm text-text-primary shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-border-light px-5 py-4">
            <div>
              <div className="font-semibold">{localize('com_ui_artifact_edit_element')}</div>
              <div className="mt-0.5 text-xs uppercase tracking-wide text-text-secondary">
                {selection.tag}
              </div>
            </div>
            <Type className="size-5 text-text-secondary" aria-hidden="true" />
          </div>

          <div className="max-h-[55vh] space-y-4 overflow-y-auto p-5">
            {selection.text !== '' && (
              <label className="block space-y-2">
                <span className="font-medium">{localize('com_ui_artifact_text_content')}</span>
                <textarea
                  value={selection.text}
                  onChange={(event) =>
                    setSelection((current) =>
                      current ? { ...current, text: event.target.value } : current,
                    )
                  }
                  className="min-h-24 w-full resize-y rounded-xl border border-border-medium bg-surface-secondary p-3 outline-none focus:border-border-heavy"
                />
              </label>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-2">
                <span className="font-medium">{localize('com_ui_artifact_text_color')}</span>
                <input
                  value={selection.color}
                  onChange={(event) =>
                    setSelection((current) =>
                      current ? { ...current, color: event.target.value } : current,
                    )
                  }
                  className="w-full rounded-xl border border-border-medium bg-surface-secondary px-3 py-2 outline-none focus:border-border-heavy"
                />
              </label>
              <label className="space-y-2">
                <span className="font-medium">{localize('com_ui_artifact_background')}</span>
                <input
                  value={selection.backgroundColor}
                  onChange={(event) =>
                    setSelection((current) =>
                      current ? { ...current, backgroundColor: event.target.value } : current,
                    )
                  }
                  className="w-full rounded-xl border border-border-medium bg-surface-secondary px-3 py-2 outline-none focus:border-border-heavy"
                />
              </label>
            </div>

            <label className="block space-y-2">
              <span className="font-medium">{localize('com_ui_artifact_typography')}</span>
              <input
                value={selection.fontSize}
                onChange={(event) =>
                  setSelection((current) =>
                    current ? { ...current, fontSize: event.target.value } : current,
                  )
                }
                className="w-full rounded-xl border border-border-medium bg-surface-secondary px-3 py-2 outline-none focus:border-border-heavy"
              />
            </label>

            <label className="block space-y-2">
              <span className="font-medium">{localize('com_ui_artifact_display')}</span>
              <div className="relative">
                <select
                  value={selection.display}
                  onChange={(event) =>
                    setSelection((current) =>
                      current ? { ...current, display: event.target.value } : current,
                    )
                  }
                  className="w-full appearance-none rounded-xl border border-border-medium bg-surface-secondary px-3 py-2 pr-9 outline-none focus:border-border-heavy"
                >
                  {['block', 'inline', 'inline-block', 'flex', 'grid', 'none'].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-2.5 size-4" />
              </div>
            </label>

            {saveError && <p className="text-xs text-status-error">{saveError}</p>}
            {chatForm && (
              <button
                type="button"
                onClick={addAnnotationToDraft}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border-medium bg-surface-secondary px-3 py-2.5 text-sm font-medium transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy"
              >
                <MessageSquarePlus className="size-4" aria-hidden="true" />
                Tambahkan instruksi ke chat
              </button>
            )}
            <Button
              type="button"
              onClick={applyChanges}
              disabled={!editable || isMutating}
              className="w-full gap-2"
            >
              <Save className="size-4" aria-hidden="true" />
              {isMutating ? localize('com_ui_saving') : localize('com_ui_artifact_apply_changes')}
            </Button>
          </div>
        </aside>
      )}
    </div>
  );
}
