import { useEffect, useMemo, useState } from 'react';
import type { Artifact } from '~/common';
import { TOOL_ARTIFACT_TYPES } from '~/utils/artifacts';

const JSON_TYPES = new Set<string>([TOOL_ARTIFACT_TYPES.JSON]);

export const isInlineDataArtifact = (type: string | null | undefined): boolean =>
  type === TOOL_ARTIFACT_TYPES.PLAIN_TEXT;

/**
 * Formats JSON only when it is valid. Invalid JSON remains visible exactly as
 * it was written, which is useful while an agent is still streaming a file.
 */
export function formatStructuredArtifactContent(content: string, type: string | null | undefined) {
  if (!JSON_TYPES.has(type ?? '')) {
    return content;
  }

  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

export function SvgArtifactPreview({
  content,
  title,
  fillContainer = false,
}: {
  content: string;
  title?: string | null;
  fillContainer?: boolean;
}) {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(new Blob([content], { type: 'image/svg+xml' }));
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [content]);

  if (!sourceUrl) {
    return null;
  }

  return (
    <div
      className={fillContainer ? 'flex h-full w-full items-center justify-center p-4' : 'w-full p-4'}
    >
      {/* An SVG is intentionally loaded as an image rather than injected into
          the DOM. That preserves the visual artifact while preventing SVG
          scripts, event handlers, and foreignObject content from executing. */}
      <img
        src={sourceUrl}
        alt={title ?? 'SVG artifact'}
        className={
          fillContainer
            ? 'h-full max-h-full w-full max-w-full object-contain'
            : 'mx-auto block h-auto max-h-[72vh] w-auto max-w-full object-contain'
        }
      />
    </div>
  );
}

export function InlineDataArtifactPreview({ artifact }: { artifact: Artifact }) {
  const [expanded, setExpanded] = useState(false);
  const content = useMemo(
    () => formatStructuredArtifactContent(artifact.content ?? '', artifact.type),
    [artifact.content, artifact.type],
  );

  return (
    <div className="w-full bg-surface-primary p-4 sm:p-5">
      <pre
        className={
          expanded
            ? 'max-h-[78vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface-secondary p-4 font-mono text-xs leading-6 text-text-primary sm:text-sm'
            : 'max-h-[440px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-surface-secondary p-4 font-mono text-xs leading-6 text-text-primary sm:text-sm'
        }
      >
        {content}
      </pre>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="mt-2 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy"
      >
        {expanded ? 'Tampilkan ringkas' : 'Perluas tampilan'}
      </button>
    </div>
  );
}
