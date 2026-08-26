import { useEffect, useState } from 'react';
import axios from 'axios';
import { Button } from '@librechat/client';
import { ExternalLink, Upload } from 'lucide-react';
import type { Artifact } from '~/common';
import { useCodeState } from '~/Providers';

type PublishResult = {
  url: string;
  version: number;
  content: string;
};

export default function ArtifactPublishButton({ artifact }: { artifact: Artifact }) {
  const { currentCode } = useCodeState();
  const [result, setResult] = useState<PublishResult | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const content = currentCode ?? artifact.content ?? '';
  const isCurrentVersionPublished = result?.content === content;

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [artifact.id]);

  const publish = async () => {
    if (result && isCurrentVersionPublished) {
      window.open(result.url, '_blank', 'noopener,noreferrer');
      return;
    }
    setIsPublishing(true);
    setError(null);
    try {
      const response = await axios.post<Omit<PublishResult, 'content'>>('/api/artifacts/publish', {
        artifactId: artifact.id,
        title: artifact.title,
        content,
      });
      setResult({ ...response.data, content });
    } catch (_error) {
      setError('Publish gagal');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-status-error">{error}</span>}
      <Button
        type="button"
        size="sm"
        onClick={publish}
        disabled={isPublishing}
        className="h-9 gap-2 rounded-xl"
        title={
          isCurrentVersionPublished
            ? `Versi ${result?.version} sudah dipublikasikan`
            : result
              ? 'Publikasikan perubahan sebagai versi baru'
              : 'Publish website'
        }
      >
        {isCurrentVersionPublished ? (
          <ExternalLink className="size-4" aria-hidden="true" />
        ) : (
          <Upload className="size-4" aria-hidden="true" />
        )}
        {isPublishing
          ? 'Publishing…'
          : isCurrentVersionPublished
            ? 'Buka hasil'
            : result
              ? 'Update'
              : 'Publish'}
      </Button>
    </div>
  );
}
