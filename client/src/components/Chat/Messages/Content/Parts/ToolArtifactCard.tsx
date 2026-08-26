import { memo, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { Download } from 'lucide-react';
import {
  useRecoilCallback,
  useRecoilState,
  useRecoilValue,
  useResetRecoilState,
  useSetRecoilState,
} from 'recoil';
import type { TAttachment, TFile, TAttachmentMetadata } from 'librechat-data-provider';
import type { Artifact } from '~/common';
import FilePreview from '~/components/Chat/Input/Files/FilePreview';
import InlineArtifactPreview, {
  supportsInlineArtifact,
} from '~/components/Artifacts/InlineArtifactPreview';
import { isCodeOnlyArtifact } from '~/utils/artifacts';
import { displayFilename } from './attachmentTypes';
import { useAttachmentLink } from './LogLink';
import { useLocalize } from '~/hooks';
import { cn, getFileType } from '~/utils';
import store from '~/store';

interface ToolArtifactCardProps {
  attachment: TAttachment;
  artifact: Artifact;
}

/**
 * Card that opens a code-execution-produced artifact in the side panel.
 *
 * Three effects, separately scoped:
 *
 *  1. **Dedup claim** (`useLayoutEffect`, runs synchronously before
 *     paint). The same file can appear in multiple tool calls within a
 *     single message (e.g. the agent reads back what it just wrote) or
 *     across messages. Each card claims `toolArtifactClaim(artifact.id)`
 *     with its unique component-instance key on mount; the latest card
 *     to mount wins, so older duplicates re-render to `null`. The atom
 *     is family-keyed by artifact id, so claims for unrelated artifacts
 *     don't trigger re-renders here. Cleanup releases the claim if it's
 *     still ours so a subsequent re-mount can take it.
 *
 *  2. **Self-heal registration** subscribes to the per-id selector
 *     `artifactByIdSelector(artifact.id)` and writes only when the
 *     entry is missing or the cached content/type/title drifted. The
 *     panel's `useArtifacts` hook resets `artifactsState` on close, so
 *     this re-fires deterministically once the slice transitions back
 *     to `undefined` — without the no-deps render-loop pattern. The
 *     write is also gated on `isMyClaim`, making the registration
 *     single-writer per id: when two cards exist for the same file
 *     across turns, only the latest (claim-holder) updates state.
 *     Without that guard, both cards would observe each other's write
 *     and trade overwrites in a loop.
 *
 *  3. **Focus + open on mount** (deps: artifact.id, artifact.type) —
 *     gated on `isSubmitting` captured at first render via a ref AND
 *     on `artifact.type !== CODE`. A card mounted *during* streaming
 *     for a rich-preview bucket (HTML, React, Markdown, plain text)
 *     steals panel focus and forces `artifactsVisibility = true` so
 *     the panel auto-opens — matching the legacy SSE auto-open UX.
 *     A card mounted while `isSubmitting === false` is part of
 *     conversation history (page load, back-navigation) and must not
 *     steal focus — `Presentation`'s render condition gates on
 *     `currentArtifactId != null`, so leaving both alone keeps the
 *     panel closed on history load. The CODE bucket (`.py`, `.js`,
 *     `Dockerfile`, …) is click-to-open *even on streaming*: source
 *     files are typically supporting scripts the agent emits alongside
 *     a richer deliverable, and shoving the panel in front of the
 *     user every time a helper script gets written is disruptive.
 *     Click-to-open via `handleOpen` works for every bucket regardless
 *     of context.
 */
const ToolArtifactCard = memo(({ attachment, artifact }: ToolArtifactCardProps) => {
  const localize = useLocalize();
  const claimKey = useId();
  const file = attachment as TFile & TAttachmentMetadata;
  const fileId = file.file_id;
  const setVisible = useSetRecoilState(store.artifactsVisibility);
  const setArtifacts = useSetRecoilState(store.artifactsState);
  const setCurrentArtifactId = useSetRecoilState(store.currentArtifactId);
  const resetCurrentArtifactId = useResetRecoilState(store.currentArtifactId);
  const currentArtifactId = useRecoilValue(store.currentArtifactId);
  const existingEntry = useRecoilValue(store.artifactByIdSelector(artifact.id));
  const isSubmittingAtMount = useRecoilValue(store.isSubmittingFamily(0));
  const mountedDuringStreamRef = useRef(isSubmittingAtMount);
  const autoFocusHandledRef = useRef(false);
  const [claim, setClaim] = useRecoilState(store.toolArtifactClaim(artifact.id));
  const isSelected = artifact.id === currentArtifactId;
  const isMyClaim = claim === claimKey;
  /* Read+reset on mount only — `useRecoilCallback` avoids subscribing
   * to the per-file_id flag (no re-renders when other files resolve).
   * The deferred-preview hook flips this to `true` on the pending→ready
   * edge; we consume it once and reset, so repeat mounts (panel close
   * then reopen, history scroll) don't auto-open a second time. */
  const consumeJustResolved = useRecoilCallback(
    ({ snapshot, reset }) =>
      (id: string) => {
        const flagged = snapshot.getLoadable(store.previewJustResolved(id)).valueMaybe() ?? false;
        if (flagged) {
          reset(store.previewJustResolved(id));
        }
        return flagged;
      },
    [],
  );
  useLayoutEffect(() => {
    // Always (re)claim on mount — a later card for the same id displaces
    // an earlier one, so the chip migrates to the most recent mention.
    setClaim(claimKey);
    return () => {
      // Only release when the claim is still ours; if a sibling already
      // took over we don't want to clobber its claim.
      setClaim((prev) => (prev === claimKey ? null : prev));
    };
  }, [claimKey, setClaim]);

  useEffect(() => {
    // Only the claim-winner writes. Two cards with the same `artifact.id`
    // but divergent content (same file_id reused across turns) would
    // otherwise see each other's write through `existingEntry`, detect
    // drift, and trade overwrites in a loop. Gating on `isMyClaim`
    // makes registration single-writer per id.
    if (!isMyClaim) {
      return;
    }
    if (
      existingEntry != null &&
      existingEntry.content === artifact.content &&
      existingEntry.type === artifact.type &&
      existingEntry.title === artifact.title
    ) {
      return;
    }
    setArtifacts((prev) => ({ ...(prev ?? {}), [artifact.id]: artifact }));
  }, [artifact, existingEntry, isMyClaim, setArtifacts]);

  useEffect(() => {
    if (autoFocusHandledRef.current || !isMyClaim || isCodeOnlyArtifact(artifact.type)) {
      return;
    }
    const justResolved = fileId ? consumeJustResolved(fileId) : false;
    autoFocusHandledRef.current = true;
    if (mountedDuringStreamRef.current || justResolved) {
      setCurrentArtifactId(artifact.id);
      setVisible(true);
    }
  }, [
    artifact.id,
    artifact.type,
    consumeJustResolved,
    fileId,
    isMyClaim,
    setCurrentArtifactId,
    setVisible,
  ]);

  const { handleDownload } = useAttachmentLink({
    href: attachment.filepath ?? '',
    filename: attachment.filename ?? '',
    file_id: file.file_id,
    user: file.user,
    source: file.source,
  });

  const handleOpen = () => {
    if (isSelected) {
      resetCurrentArtifactId();
      setVisible(false);
      return;
    }
    // Registration already happened in the mount effect; the click only
    // needs to focus + reveal the panel for users who have closed it.
    setCurrentArtifactId(artifact.id);
    setVisible(true);
  };

  // Another card with the same artifact id has the active claim — render
  // nothing here, that card is the canonical chip for this file.
  if (claim != null && !isMyClaim) {
    return null;
  }

  const fileType = getFileType('artifact');
  const actionLabel = isSelected
    ? localize('com_ui_click_to_close')
    : localize('com_ui_artifact_click');
  const visibleFilename = displayFilename(attachment.filename);
  // The artifact's stored `title` mirrors the on-disk `filename` for
  // tool artifacts, so re-derive the user-facing label rather than
  // showing the collision-suffixed name.
  const visibleTitle = displayFilename(artifact.title);
  if (supportsInlineArtifact(artifact)) {
    return <InlineArtifactPreview artifact={artifact} />;
  }
  return (
    <div className="my-2 w-full text-sm text-text-primary">
      <div className="group relative inline-flex max-w-fit items-stretch gap-px overflow-hidden rounded-xl shadow-sm">
        <button
          type="button"
          onClick={handleOpen}
          aria-pressed={isSelected}
          className={cn(
            'relative overflow-hidden rounded-l-xl transition-all duration-200 hover:bg-surface-hover active:scale-[0.99]',
            {
              'border-border-medium bg-surface-hover': isSelected,
              'border-border-light bg-surface-tertiary': !isSelected,
            },
          )}
        >
          <div className="w-fit p-2">
            <div className="flex flex-row items-center gap-2">
              <FilePreview fileType={fileType} className="relative" />
              <div className="overflow-hidden text-left">
                <div className="truncate font-medium" title={visibleFilename}>
                  {visibleTitle}
                </div>
                <div className="truncate text-xs text-text-secondary">{actionLabel}</div>
              </div>
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={handleDownload}
          aria-label={`${localize('com_ui_download')} ${visibleFilename}`}
          title={localize('com_ui_download')}
          className={cn(
            'flex shrink-0 items-center justify-center px-3 transition-colors duration-200',
            'rounded-r-xl bg-surface-tertiary text-text-secondary hover:bg-surface-hover hover:text-text-primary',
            'border-l border-border-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy',
          )}
        >
          <Download className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
});

ToolArtifactCard.displayName = 'ToolArtifactCard';

export default ToolArtifactCard;
