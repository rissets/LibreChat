import type { Artifact } from '~/common';

export type ArtifactAnnotation = {
  tag?: string;
  text?: string;
};

const compact = (value: string, maxLength = 180): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
};

/**
 * Produces a draft-only instruction. It never submits a message; the user can
 * append their request before sending it to the agent.
 */
export function buildArtifactAnnotationPrompt(
  artifact: Artifact,
  annotation?: ArtifactAnnotation | null,
): string {
  const title = compact(artifact.title ?? 'artifact');
  const tag = annotation?.tag ? ` pada elemen ${annotation.tag}` : '';
  const selectedText = compact(annotation?.text ?? '');
  const context = selectedText ? ` yang berisi “${selectedText}”` : '';
  return `Perbarui artifact “${title}”${tag}${context}. Pertahankan bagian lain. Perubahan yang saya inginkan: `;
}
