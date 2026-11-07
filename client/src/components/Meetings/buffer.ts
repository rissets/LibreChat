import { z } from 'zod';
import { meetingAudioInputSchema } from 'librechat-data-provider';

const storedSchema = z.object({
  frames: z
    .array(
      meetingAudioInputSchema.extend({
        stored_at: z.number().finite().nonnegative(),
        expires_at: z.number().finite().nonnegative().optional(),
      }),
    )
    .max(5),
  interruption: z.enum(['device', 'permission', 'network', 'buffer', 'browser_stopped']).nullable(),
});
export type CaptureBuffer = z.infer<typeof storedSchema>;
export type BufferedFrame = CaptureBuffer['frames'][number];
const epochs = new Map<string, number>();
export const bufferEpoch = (key: string) => epochs.get(key) ?? 0;

/** Temporary recovery only. The account/session key is never shared between signed-in users. */
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('meeting-capture-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pending');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('MEETING_BROWSER_STORAGE_UNAVAILABLE'));
  });
}

export async function readBuffer(key: string, maximumAgeSeconds = 300): Promise<CaptureBuffer> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('pending', 'readwrite');
      const cursor = transaction.objectStore('pending').openCursor();
      let selected: CaptureBuffer = { frames: [], interruption: null };
      let invalid = false;
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        const result = storedSchema.safeParse(item.value);
        if (!result.success) {
          if (item.key === key) invalid = true;
          item.delete();
          item.continue();
          return;
        }
        const frames = result.data.frames.filter((frame) => {
          // Legacy records had no stored expiry; their previous 300s recovery ceiling
          // remains a conservative on-next-open limit, never a new production duration.
          const expiry = frame.expires_at ?? frame.stored_at + 300000;
          const current = item.key === key ? frame.stored_at + maximumAgeSeconds * 1000 : expiry;
          return (
            frame.stored_at <= Date.now() &&
            Date.now() < Math.min(expiry, current, frame.stored_at + 3600000)
          );
        });
        const value = { ...result.data, frames };
        if (frames.length === 0 && value.interruption === null) item.delete();
        else if (frames.length !== result.data.frames.length) item.update(value);
        if (item.key === key) selected = value;
        item.continue();
      };
      transaction.oncomplete = () =>
        invalid ? reject(new Error('MEETING_BROWSER_STORAGE_INVALID')) : resolve(selected);
      transaction.onerror = () => reject(new Error('MEETING_BROWSER_STORAGE_UNAVAILABLE'));
      transaction.onabort = () => reject(new Error('MEETING_BROWSER_STORAGE_UNAVAILABLE'));
    });
  } finally {
    db.close();
  }
}

export async function saveBuffer(
  key: string,
  value: CaptureBuffer,
  maximumAgeSeconds = 300,
  epoch = bufferEpoch(key),
): Promise<void> {
  if (epoch !== bufferEpoch(key)) return;
  const db = await database();
  try {
    if (epoch !== bufferEpoch(key)) return;
    const bounded = storedSchema.parse(value);
    const frames = bounded.frames
      .map((frame) => ({
        ...frame,
        expires_at: Math.min(
          frame.expires_at ?? Infinity,
          frame.stored_at + maximumAgeSeconds * 1000,
        ),
      }))
      .filter((frame) => frame.expires_at > Date.now());
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('pending', 'readwrite');
      const store = transaction.objectStore('pending');
      if (frames.length === 0 && bounded.interruption === null) store.delete(key);
      else store.put({ ...bounded, frames }, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('MEETING_BROWSER_STORAGE_UNAVAILABLE'));
      transaction.onabort = () => reject(new Error('MEETING_BROWSER_STORAGE_UNAVAILABLE'));
    });
  } finally {
    db.close();
  }
}

export async function discardBuffer(key: string): Promise<void> {
  epochs.set(key, bufferEpoch(key) + 1);
  await saveBuffer(key, { frames: [], interruption: null });
}

/** Opening the meeting surface also sweeps expired dormant keys, without uploading them. */
export async function purgeBuffers(): Promise<void> {
  await readBuffer('');
}
