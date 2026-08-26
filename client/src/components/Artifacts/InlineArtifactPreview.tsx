import { useId, useLayoutEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { useRecoilState, useSetRecoilState } from 'recoil';
import { MessageSquarePlus } from 'lucide-react';
import type { SandpackPreviewRef } from '@codesandbox/sandpack-react/unstyled';
import type { Artifact } from '~/common';
import { useGetStartupConfig } from '~/data-provider';
import useArtifactProps from '~/hooks/Artifacts/useArtifactProps';
import { TOOL_ARTIFACT_TYPES } from '~/utils/artifacts';
import { ArtifactPreview } from './ArtifactPreview';
import {
  InlineDataArtifactPreview,
  isInlineDataArtifact,
  SvgArtifactPreview,
} from './InlineDataArtifactPreview';
import store from '~/store';

const INLINE_TYPES = new Set<string>([
  TOOL_ARTIFACT_TYPES.HTML,
  TOOL_ARTIFACT_TYPES.REACT,
  TOOL_ARTIFACT_TYPES.MERMAID,
  TOOL_ARTIFACT_TYPES.SVG,
  TOOL_ARTIFACT_TYPES.MARKDOWN,
  TOOL_ARTIFACT_TYPES.PLAIN_TEXT,
  TOOL_ARTIFACT_TYPES.DOCX,
  TOOL_ARTIFACT_TYPES.SPREADSHEET,
  TOOL_ARTIFACT_TYPES.PRESENTATION,
]);

/**
 * Generated deliverables are sometimes returned twice: once as a saved code
 * output (whose title is the filename) and once as a direct `:::artifact`
 * block (whose identifier/title is human-readable).  Those two labels often
 * differ only by presentation words such as "analisis", "AHU", or "chart".
 *
 * Keep the meaningful part of the name as the claim key so both routes share
 * a single inline preview.  The MIME bucket remains part of the key: an HTML
 * dashboard and a Mermaid diagram intentionally remain separate artifacts.
 */
const INLINE_IDENTITY_NOISE = new Set([
  'analisis',
  'analysis',
  'anomali',
  'anomaly',
  'data',
  'ahu',
  'chart',
  'charts',
  'grafik',
  'graph',
  'interactive',
  'interaktif',
  'final',
  'updated',
  'update',
  'hasil',
  'result',
]);

const canonicalInlineToken = (token: string): string => {
  if (token === 'profil') {
    return 'profile';
  }
  return token;
};

function contentFingerprint(content: string): string {
  // A small deterministic fingerprint is enough for render de-duplication and
  // avoids pulling a crypto implementation into the browser bundle. The
  // content itself remains the source of truth; this is only a Recoil key.
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export const logicalInlineArtifactIdentity = (artifact: Artifact): string => {
  const content = artifact.content?.trim();
  if (content) {
    return `${artifact.type ?? 'unknown'}:content-${contentFingerprint(content)}`;
  }
  const label = artifact.identifier ?? artifact.title ?? 'artifact';
  const tokens = label
    .normalize('NFKD')
    .replace(/\.[a-z0-9]{1,10}$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(canonicalInlineToken)
    .filter((token) => token.length > 0 && !/^\d+$/.test(token) && !INLINE_IDENTITY_NOISE.has(token));
  const name = tokens.join('-') || 'artifact';
  return `${artifact.type ?? 'unknown'}:${name}`;
};

export const supportsInlineArtifact = (artifact: Artifact): boolean =>
  INLINE_TYPES.has(artifact.type ?? '') && (artifact.content?.length ?? 0) > 0;

export default function InlineArtifactPreview({ artifact }: { artifact: Artifact }) {
  const previewRef = useRef<SandpackPreviewRef>(null);
  const claimKey = useId();
  const identity = logicalInlineArtifactIdentity(artifact);
  const [claim, setClaim] = useRecoilState(store.inlineArtifactClaim(identity));
  const setArtifacts = useSetRecoilState(store.artifactsState);
  const setCurrentArtifactId = useSetRecoilState(store.currentArtifactId);
  const setArtifactVisibility = useSetRecoilState(store.artifactsVisibility);
  const isClaimHolder = claim === claimKey;
  const { data: startupConfig } = useGetStartupConfig();
  const { files, fileKey, template, sharedProps } = useArtifactProps({ artifact });

  useLayoutEffect(() => {
    setClaim(claimKey);
    return () => {
      setClaim((previous) => (previous === claimKey ? null : previous));
    };
  }, [claimKey, setClaim]);

  if (!supportsInlineArtifact(artifact) || !isClaimHolder) {
    return null;
  }

  const openForAnnotation = () => {
    setArtifacts((previous) => ({ ...(previous ?? {}), [artifact.id]: artifact }));
    setCurrentArtifactId(artifact.id);
    setArtifactVisibility(true);
  };

  const annotationControl = (
    <div className="absolute right-3 top-3 z-10">
      <button
        type="button"
        onClick={openForAnnotation}
        className="inline-flex items-center gap-1.5 rounded-full border border-border-light bg-surface-primary/95 px-3 py-1.5 text-xs font-medium text-text-primary shadow-sm backdrop-blur transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy"
      >
        <MessageSquarePlus className="size-3.5" aria-hidden="true" />
        Anotasi
      </button>
    </div>
  );

  if (artifact.type === TOOL_ARTIFACT_TYPES.SVG) {
    return (
      <section
        aria-label={artifact.title ?? 'HelloDigi SVG artifact'}
        className="hellodigi-artifact-scroll relative my-3 mx-auto w-fit max-w-full overflow-auto rounded-2xl border border-border-light bg-surface-primary shadow-sm"
      >
        {annotationControl}
        <SvgArtifactPreview content={artifact.content ?? ''} title={artifact.title} />
      </section>
    );
  }

  if (isInlineDataArtifact(artifact.type)) {
    return (
      <section
        aria-label={artifact.title ?? 'HelloDigi data artifact'}
        className="hellodigi-artifact-scroll relative my-3 w-full max-w-[1100px] overflow-hidden rounded-2xl border border-border-light bg-surface-primary shadow-sm"
      >
        {annotationControl}
        <InlineDataArtifactPreview artifact={artifact} />
      </section>
    );
  }

  return (
    <section
      aria-label={artifact.title ?? 'HelloDigi artifact preview'}
      className="hellodigi-artifact-scroll relative my-3 w-full max-w-none overflow-hidden rounded-2xl border border-border-light bg-surface-primary shadow-sm sm:-ml-9 sm:w-[calc(100%+36px)]"
    >
      {annotationControl}
      <div className="h-[min(64vh,680px)] min-h-[360px] w-full overflow-hidden bg-surface-primary sm:min-h-[420px]">
        <ArtifactPreview
          files={files}
          fileKey={fileKey}
          template={template}
          previewRef={previewRef as MutableRefObject<SandpackPreviewRef>}
          sharedProps={sharedProps}
          startupConfig={startupConfig}
        />
      </div>
    </section>
  );
}
