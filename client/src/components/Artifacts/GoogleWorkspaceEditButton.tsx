import { useState } from 'react';
import axios from 'axios';
import { Button, useToastContext } from '@librechat/client';
import { ExternalLink, LoaderCircle } from 'lucide-react';
import { request } from 'librechat-data-provider';
import { useReinitializeMCPServerMutation } from 'librechat-data-provider/react-query';
import type { Artifact } from '~/common';
import { useCodeOutputDownload, useFileDownload } from '~/data-provider';
import { isLocallyStoredSource } from '~/components/Chat/Messages/Content/Parts/LogLink';
import { isPreviewOnlyArtifact } from '~/utils/artifacts';
import { useLocalize } from '~/hooks';

interface GoogleWorkspaceStatus {
  configured: boolean;
  connected: boolean;
  serverName: string;
}

interface GoogleWorkspaceImportResult {
  fileId: string;
  name: string;
  mimeType: string;
  editorUrl: string;
}

export default function GoogleWorkspaceEditButton({ artifact }: { artifact: Artifact }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [busy, setBusy] = useState(false);
  const download = artifact.download;
  const isLocal = isLocallyStoredSource(download?.source);
  const { refetch: downloadLocal } = useFileDownload(download?.user, download?.file_id, {
    source: download?.source,
    direct: false,
  });
  const { refetch: downloadCodeOutput } = useCodeOutputDownload(download?.filepath ?? '');
  const initializeDrive = useReinitializeMCPServerMutation();

  if (!isPreviewOnlyArtifact(artifact.type) || !download) {
    return null;
  }

  const connectDrive = async () => {
    const response = await initializeDrive.mutateAsync('google-drive');
    if (response.oauthRequired && response.oauthUrl) {
      window.open(response.oauthUrl, '_blank', 'noopener,noreferrer');
      showToast({ status: 'info', message: localize('com_ui_google_complete_oauth') });
      return;
    }
    if (!response.success) {
      throw new Error(response.message || 'Google Drive connection failed');
    }
  };

  const getFileBlob = async (): Promise<Blob> => {
    const result = isLocal ? await downloadLocal() : await downloadCodeOutput();
    const objectUrl = result.data;
    if (!objectUrl) {
      throw new Error('Generated file is no longer available');
    }
    try {
      const response = await fetch(objectUrl);
      if (!response.ok) {
        throw new Error('Generated file could not be loaded');
      }
      return await response.blob();
    } finally {
      if (objectUrl.startsWith('blob:')) {
        window.URL.revokeObjectURL(objectUrl);
      }
    }
  };

  const openInGoogle = async () => {
    setBusy(true);
    try {
      const status = await request.get<GoogleWorkspaceStatus>('/api/google-workspace/status');
      if (!status.configured) {
        showToast({ status: 'error', message: localize('com_ui_google_not_configured') });
        return;
      }
      if (!status.connected) {
        await connectDrive();
        return;
      }
      const blob = await getFileBlob();
      const form = new FormData();
      form.append('file', blob, artifact.title ?? 'HelloDigi file');
      const imported = (await request.postMultiPart(
        '/api/google-workspace/import',
        form,
      )) as GoogleWorkspaceImportResult;
      window.open(imported.editorUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        await connectDrive();
        return;
      }
      console.error('Google Workspace handoff failed:', error);
      showToast({ status: 'error', message: localize('com_ui_google_open_failed') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-9 gap-1.5"
      onClick={() => void openInGoogle()}
      disabled={busy || initializeDrive.isLoading}
    >
      {busy || initializeDrive.isLoading ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <ExternalLink className="size-4" aria-hidden="true" />
      )}
      <span className="hidden lg:inline">{localize('com_ui_edit_in_google')}</span>
    </Button>
  );
}
