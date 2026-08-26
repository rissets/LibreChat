import { useMemo } from 'react';
import { ArrowRight, Download, Files, MessageSquareText } from 'lucide-react';
import { useSetRecoilState } from 'recoil';
import { Tools } from 'librechat-data-provider';
import type { TAttachment, TFile, TAttachmentMetadata } from 'librechat-data-provider';
import type { TAskFunction } from '~/common';
import FilePreview from '~/components/Chat/Input/Files/FilePreview';
import { useAttachmentLink } from './Content/Parts/LogLink';
import { displayFilename } from './Content/Parts/attachmentTypes';
import { fileToArtifact } from '~/utils/artifacts';
import { useLocalize } from '~/hooks';
import { cn, getFileType } from '~/utils';
import store from '~/store';

function fileIdentity(attachment: TAttachment, index: number): string {
  const file = attachment as Partial<TFile>;
  return file.file_id ?? file.filepath ?? file.filename ?? `generated-${index}`;
}

function readableSize(value?: number): string {
  if (!value || value < 1) {
    return '';
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function GeneratedFileCard({ attachment }: { attachment: TAttachment }) {
  const localize = useLocalize();
  const file = attachment as TFile & TAttachmentMetadata;
  const artifact = useMemo(() => fileToArtifact(file), [file]);
  const setArtifacts = useSetRecoilState(store.artifactsState);
  const setCurrentArtifactId = useSetRecoilState(store.currentArtifactId);
  const setVisible = useSetRecoilState(store.artifactsVisibility);
  const { handleDownload } = useAttachmentLink({
    href: file.filepath ?? '',
    filename: file.filename ?? '',
    file_id: file.file_id,
    user: file.user,
    source: file.source,
  });
  const fileType = getFileType(artifact ? 'artifact' : (file.type ?? ''));
  const title = displayFilename(file.filename) || localize('com_ui_generated_file');
  const subtitle = [
    artifact ? localize('com_ui_artifacts') : file.type || localize('com_ui_file'),
    readableSize(file.bytes),
  ]
    .filter(Boolean)
    .join(' · ');

  const openFile = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!artifact) {
      void handleDownload(event);
      return;
    }
    setArtifacts((previous) => ({ ...(previous ?? {}), [artifact.id]: artifact }));
    setCurrentArtifactId(artifact.id);
    setVisible(true);
  };

  return (
    <div className="group flex min-w-0 items-stretch overflow-hidden rounded-xl border border-border-light bg-surface-secondary transition-colors hover:bg-surface-hover">
      <button
        type="button"
        onClick={openFile}
        className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
      >
        <FilePreview file={file} fileType={fileType} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-text-primary" title={title}>
            {title}
          </span>
          <span className="block truncate text-xs text-text-secondary">{subtitle}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={(event) => void handleDownload(event)}
        className="flex w-11 shrink-0 items-center justify-center border-l border-border-light text-text-secondary hover:text-text-primary"
        aria-label={`${localize('com_ui_download')} ${title}`}
      >
        <Download className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}


function suggestedPrompts(attachments: TAttachment[]): string[] {
  const extensions = attachments.map((item) =>
    (item.filename ?? '').split('.').pop()?.toLowerCase(),
  );
  if (extensions.some((extension) => extension === 'xlsx' || extension === 'csv')) {
    return [
      'Tampilkan insight utama dari data ini sebagai dashboard interaktif.',
      'Buat chart lanjutan dan jelaskan anomali datanya.',
      'Siapkan versi yang dapat diedit di Google Sheets.',
    ];
  }
  if (extensions.some((extension) => extension === 'pptx')) {
    return [
      'Perbaiki storytelling dan desain setiap slide.',
      'Buat versi ringkas untuk presentasi 5 menit.',
      'Ekspor deck ini menjadi PDF dan Google Slides.',
    ];
  }
  if (extensions.some((extension) => extension === 'docx' || extension === 'md')) {
    return [
      'Ringkas dokumen ini menjadi executive summary.',
      'Perbarui dokumen dengan tabel, diagram, dan rekomendasi.',
      'Siapkan versi yang dapat diedit di Google Docs.',
    ];
  }
  if (extensions.some((extension) => extension === 'html' || extension === 'tsx')) {
    return [
      'Sempurnakan tampilan mobile dan aksesibilitasnya.',
      'Tambahkan data nyata, state, dan interaksi lanjutan.',
      'Uji alur utama lalu siapkan versi untuk dipublikasikan.',
    ];
  }
  return [
    'Buat visualisasi interaktif dari hasil ini.',
    'Ringkas hasil dan susun langkah implementasi berikutnya.',
    'Buat dokumen atau slide presentasi dari hasil ini.',
  ];
}

export default function ResponseCompletion({
  attachments,
  ask,
  showSuggestions = false,
}: {
  attachments: TAttachment[];
  ask: TAskFunction;
  messageId?: string | null;
  /** Suggestions belong to the active response only; generated files are historical. */
  showSuggestions?: boolean;
}) {
  const localize = useLocalize();
  const files = useMemo(() => {
    const seen = new Set<string>();
    return attachments.filter((attachment, index) => {
      if (attachment.type === Tools.web_search) {
        return false;
      }
      const file = attachment as Partial<TFile>;
      if (!file.filepath && !file.file_id) {
        return false;
      }
      const key = fileIdentity(attachment, index);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [attachments]);
  const prompts = useMemo(
    () => suggestedPrompts(files),
    [files],
  );

  if (files.length === 0 && !showSuggestions) {
    return null;
  }

  return (
    <div className="mt-5 space-y-5">
      {files.length > 0 && (
        <section aria-label="File hasil">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-text-primary">
            <Files className="size-4" aria-hidden="true" />
            {localize('com_ui_generated_files')}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {files.map((attachment, index) => (
              <GeneratedFileCard key={fileIdentity(attachment, index)} attachment={attachment} />
            ))}
          </div>
        </section>
      )}
      {showSuggestions && (
        <section aria-label="Rekomendasi berikutnya">
          <div className="mb-1 flex items-center gap-2 text-sm font-medium text-text-primary">
            <MessageSquareText className="size-4" aria-hidden="true" />
            {localize('com_ui_continue_with')}
          </div>
          <div className="divide-y divide-border-light">
            {prompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => ask({ text: prompt })}
                className={cn(
                  'group flex w-full items-center justify-between gap-4 py-3 text-left text-sm',
                  'text-text-secondary transition-colors hover:text-text-primary',
                )}
              >
                <span>{prompt}</span>
                <ArrowRight
                  className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
