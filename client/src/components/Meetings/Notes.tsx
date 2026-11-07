import { useState } from 'react';
import { Button, useMediaQuery } from '@librechat/client';
import { Check, Columns2, Copy, FilePenLine, Sparkles } from 'lucide-react';
import { useMeetingWorkspace } from '~/data-provider/Meetings/workspace';
import { useMeetingNotes } from './NotesState';
import { useLocalize } from '~/hooks';
import Editor from './Editor';

export default function Notes({ meetingId, userId }: { meetingId: string; userId?: string }) {
  const localize = useLocalize();
  const notes = useMeetingNotes(meetingId);
  const workspace = useMeetingWorkspace(userId, meetingId);
  const [selectedMode, setMode] = useState<'write' | 'enhanced' | 'split'>('split');
  const wideNotes = useMediaQuery('(min-width: 768px)');
  const mode = selectedMode === 'split' && !wideNotes ? 'write' : selectedMode;
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const liveEnhance = workspace.data?.live_enhance;
  const currentNotes =
    !!notes &&
    !notes.dirty &&
    notes.text === workspace.data?.notes.text &&
    liveEnhance?.notes_revision === workspace.data?.notes.revision;
  const enhanced =
    currentNotes && notes.text.trim() ? (liveEnhance?.content?.enhanced_notes ?? []) : [];
  const saveLabel = () => {
    if (notes?.conflict) return 'com_meeting_workspace_conflict';
    if (notes?.failed) return 'com_meeting_workspace_save_failed';
    if (notes?.saving || notes?.dirty) return 'com_meeting_workspace_saving';
    return 'com_meeting_workspace_saved';
  };
  return (
    <section
      className="flex min-h-[420px] min-w-0 shrink-0 flex-col lg:min-h-0 lg:flex-1"
      aria-label={localize('com_meeting_workspace_notes')}
    >
      <div className="border-border-light flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={localize('com_meeting_workspace_notes_view')}
        >
          {(
            [
              { value: 'write', icon: FilePenLine, label: 'com_meeting_workspace_write' },
              { value: 'enhanced', icon: Sparkles, label: 'com_meeting_workspace_enhanced' },
              { value: 'split', icon: Columns2, label: 'com_meeting_workspace_split' },
            ] as const
          ).map(({ value, icon: Icon, label: modeLabel }) => (
            <Button
              key={value}
              variant={mode === value ? 'secondary' : 'ghost'}
              className={value === 'split' ? 'hidden md:inline-flex' : undefined}
              size="sm"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              <Icon className="mr-1.5 size-4" aria-hidden="true" />
              {localize(modeLabel)}
            </Button>
          ))}
        </div>
        <span className="text-text-secondary inline-flex items-center gap-1 text-sm">
          <Sparkles className="size-4" aria-hidden="true" />
          {localize(
            liveEnhance?.enabled
              ? 'com_meeting_workspace_enhance_on'
              : 'com_meeting_workspace_enhance_unavailable',
          )}
        </span>
      </div>
      {workspace.isError && (
        <p role="alert" className="text-sm">
          {localize('com_meeting_error')}{' '}
          <button type="button" className="underline" onClick={() => void workspace.refetch()}>
            {localize('com_meeting_retry')}
          </button>
        </p>
      )}
      <div
        className={
          'grid lg:min-h-0 lg:flex-1 ' +
          (mode === 'split' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1')
        }
      >
        {mode !== 'enhanced' && (
          <div className="flex min-h-[340px] min-w-0 flex-col p-5 lg:min-h-0">
            <Editor
              value={notes?.text ?? ''}
              disabled={!notes || workspace.isLoading || workspace.isError}
              onChange={(value) => notes?.setText(value)}
            />
            <div className="text-text-secondary mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span role="status" className="inline-flex items-center gap-1.5">
                {!notes?.dirty && !notes?.failed && (
                  <Check className="size-3.5" aria-hidden="true" />
                )}
                {localize(saveLabel())}
              </span>
              <span>{(notes?.text.length ?? 0).toLocaleString()} / 16.000</span>
            </div>
            {notes?.failed && !notes.conflict && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 self-start"
                onClick={() => void notes.flush()}
              >
                {localize('com_meeting_retry')}
              </Button>
            )}
            {notes?.conflict && (
              <div className="mt-3 flex flex-wrap gap-2" role="alert">
                <Button size="sm" variant="outline" onClick={() => notes.resolve(true)}>
                  {localize('com_meeting_workspace_use_server')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => notes.resolve(false)}>
                  {localize('com_meeting_workspace_keep_mine')}
                </Button>
              </div>
            )}
          </div>
        )}
        {mode !== 'write' && (
          <div
            className={
              'min-h-[340px] min-w-0 overflow-y-auto p-5 lg:min-h-0 ' +
              (mode === 'split' ? 'border-border-light border-t md:border-t-0 md:border-l' : '')
            }
          >
            <div className="mb-5 flex items-center gap-2">
              <Sparkles className="text-text-secondary size-4" aria-hidden="true" />
              <h3 className="font-medium">{localize('com_meeting_workspace_live_enhanced')}</h3>
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto"
                disabled={!enhanced.length}
                aria-label={localize(
                  copied ? 'com_meeting_workspace_copied' : 'com_meeting_workspace_copy_notes',
                )}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(enhanced.map((item) => item.text).join('\n\n'))
                    .then(() => {
                      setCopied(true);
                      setCopyFailed(false);
                    })
                    .catch(() => setCopyFailed(true))
                }
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            {copyFailed && (
              <p role="alert" className="text-text-secondary text-sm">
                {localize('com_meeting_workspace_copy_failed')}
              </p>
            )}
            {enhanced.length ? (
              <ul className="space-y-5">
                {enhanced.map((fact, index) => (
                  <li key={index} className="text-sm leading-7">
                    <p>{fact.text}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <div
                role="status"
                className="text-text-secondary flex min-h-48 flex-col items-center justify-center gap-3 text-center text-sm"
              >
                <Sparkles className="size-6" aria-hidden="true" />
                <p>
                  {localize(
                    !liveEnhance?.enabled
                      ? 'com_meeting_workspace_enhance_unavailable'
                      : notes?.text.trim() &&
                          (!currentNotes ||
                            liveEnhance?.state === 'processing' ||
                            liveEnhance?.state === 'queued')
                        ? 'com_meeting_workspace_enhancing'
                        : 'com_meeting_workspace_enhanced_empty',
                  )}
                </p>
              </div>
            )}
            {currentNotes && liveEnhance?.error_code && (
              <div className="mt-4 space-y-3">
                <p role="alert" className="text-text-secondary text-sm">
                  {localize('com_meeting_workspace_enhance_failed')}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void notes?.configure({ retry_live_enhance: true })}
                >
                  {localize('com_meeting_retry')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
