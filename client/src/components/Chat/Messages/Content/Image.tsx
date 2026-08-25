import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Skeleton } from '@librechat/client';
import { apiBaseUrl } from 'librechat-data-provider';
import DialogImage from './DialogImage';
import { cn } from '~/utils';

/** Max display height for chat images (Tailwind JIT class) */
export const IMAGE_MAX_H = 'max-h-[45vh]' as const;
/** Matches the `max-w-lg` Tailwind class on the wrapper button (32rem = 512px at 16px base) */
const IMAGE_MAX_W_PX = 512;

/** Caches image dimensions by src so remounts can reserve space */
const dimensionCache = new Map<string, { width: number; height: number }>();
/** Tracks URLs that have been fully painted — skip skeleton on remount */
const paintedUrls = new Set<string>();

/** Test-only: resets module-level caches */
export function _resetImageCaches(): void {
  dimensionCache.clear();
  paintedUrls.clear();
}

function computeHeightStyle(w: number, h: number): React.CSSProperties {
  return { height: `min(45vh, ${(h / w) * 100}vw, ${(h / w) * IMAGE_MAX_W_PX}px)` };
}

const Image = ({
  imagePath,
  altText,
  className,
  args,
  width,
  height,
  fileId,
  source,
}: {
  imagePath: string;
  altText: string;
  className?: string;
  args?: {
    prompt?: string;
    quality?: 'low' | 'medium' | 'high';
    size?: string;
    style?: string;
    [key: string]: unknown;
  };
  width?: number;
  height?: number;
  /** Stable file id used to mint a fresh object-store URL for old messages. */
  fileId?: string;
  /** Storage source, when present in a live attachment. */
  source?: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [freshImageUrl, setFreshImageUrl] = useState<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const refreshAttempts = useRef(0);

  const absoluteImageUrl = useMemo(() => {
    if (!imagePath) return imagePath;

    if (imagePath.startsWith('http') || imagePath.startsWith('data:')) {
      return imagePath;
    }

    // Root-relative server paths (`/images/...` static, `/api/share/...` share
    // routes) are resolved against the API base so they load under a subpath.
    if (imagePath.startsWith('/images/') || imagePath.startsWith('/api/')) {
      return `${apiBaseUrl()}${imagePath}`;
    }

    return imagePath;
  }, [imagePath]);

  /**
   * S3 paths in persisted messages are presigned URLs. They are valid for a
   * limited time and therefore cannot be treated as permanent image srcs.
   * Use the authenticated file route to mint a new URL from the stable
   * `file_id`; the server performs the normal file ACL check before signing.
   */
  const shouldRefreshImageUrl = Boolean(
    fileId &&
      absoluteImageUrl &&
      !absoluteImageUrl.startsWith('data:') &&
      !absoluteImageUrl.startsWith('blob:'),
  );

  const refreshImageUrl = useCallback(
    async (force = false) => {
      if (!shouldRefreshImageUrl || !fileId) {
        return;
      }
      if (!force && refreshAttempts.current > 0) {
        return;
      }
      if (refreshAttempts.current >= 2) {
        return;
      }

      refreshAttempts.current += 1;
      try {
        const response = await axios.get<{ url?: string }>(
          `${apiBaseUrl()}/api/files/download-url/${encodeURIComponent(fileId)}`,
          { headers: { Accept: 'application/json' } },
        );
        if (response.data.url) {
          setFreshImageUrl(response.data.url);
        }
      } catch (error) {
        // Keep the original URL as a fallback. This preserves local/share
        // images while allowing the next image error to retry once.
        console.warn('[Image] Unable to refresh persisted image URL', error);
      }
    },
    [absoluteImageUrl, fileId, shouldRefreshImageUrl, source],
  );

  useEffect(() => {
    if (!shouldRefreshImageUrl) {
      return;
    }
    void refreshImageUrl();
  }, [refreshImageUrl, shouldRefreshImageUrl]);

  const renderedImageUrl = freshImageUrl || absoluteImageUrl;

  const downloadImage = async () => {
    try {
      const response = await fetch(renderedImageUrl, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = altText || 'image.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      const link = document.createElement('a');
      link.href = renderedImageUrl;
      link.download = altText || 'image.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  useEffect(() => {
    if (width && height && renderedImageUrl) {
      dimensionCache.set(renderedImageUrl, { width, height });
    }
  }, [renderedImageUrl, width, height]);

  const dims = width && height ? { width, height } : dimensionCache.get(renderedImageUrl);
  const hasDimensions = !!(dims?.width && dims?.height);
  const heightStyle = hasDimensions ? computeHeightStyle(dims.width, dims.height) : undefined;
  const showSkeleton = hasDimensions && !paintedUrls.has(renderedImageUrl);

  return (
    <div>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`View ${altText} in dialog`}
        aria-haspopup="dialog"
        onClick={() => setIsOpen(true)}
        className={cn(
          'relative mt-1 w-full max-w-lg cursor-pointer overflow-hidden rounded-lg border border-border-light text-text-secondary-alt shadow-md transition-shadow',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-text-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-primary',
          className,
        )}
        style={heightStyle}
      >
        {showSkeleton && <Skeleton className="absolute inset-0" aria-hidden="true" />}
        <img
          alt={altText}
          src={renderedImageUrl}
          onLoad={() => paintedUrls.add(renderedImageUrl)}
          onError={() => {
            // A conversation can outlive its signed URL. Retry with a newly
            // signed URL instead of leaving a broken-image card in history.
            void refreshImageUrl(true);
          }}
          className={cn(
            'relative block text-transparent',
            hasDimensions
              ? 'size-full object-contain'
              : cn('h-auto w-auto max-w-full', IMAGE_MAX_H),
          )}
        />
      </button>
      <DialogImage
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        src={renderedImageUrl}
        downloadImage={downloadImage}
        args={args}
        triggerRef={triggerRef}
      />
    </div>
  );
};

export default Image;
