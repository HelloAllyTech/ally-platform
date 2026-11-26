/**
 * A file on a WhatsApp message (WA-A), stored on `chatbot_messages.attachments`. The object lives
 * in the private audio bucket under `wa-media/`, and goes with the conversation's retention.
 * Audio is never sent to a model; only its transcript is.
 */
export type WaAttachmentKind = 'audio' | 'image' | 'document';

export interface WaAttachment {
  kind: WaAttachmentKind;
  /** The S3 key, under `wa-media/`. Absent when the download failed (the message is still kept). */
  key?: string | null;
  mimeType: string;
  sizeBytes?: number | null;
  filename?: string | null;
  caption?: string | null;
  /** A voice note recorded in WhatsApp (as opposed to an audio file). */
  voice?: boolean;
  /** Audio: the transcript, and the language the speech provider heard. */
  transcript?: string | null;
  language?: string | null;
  durationSec?: number | null;
  /** Audio: why there is no transcript (`failed`, `too_long`, `download_failed`). */
  transcriptError?: string | null;
  /** Meta's media id, for the record. */
  mediaId?: string | null;
}

export const WA_MEDIA_PREFIX = 'wa-media/';

/** Signed links last 10 minutes: long enough to play or open, short enough not to share. */
export const WA_MEDIA_SIGNED_SECONDS = 600;

/** The attachments on a message, read leniently: anything malformed is dropped. */
export function waAttachmentsOf(value: unknown): WaAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (a): a is WaAttachment =>
      Boolean(a) &&
      typeof a === 'object' &&
      ['audio', 'image', 'document'].includes((a as WaAttachment).kind),
  );
}

/** The stored `wa-media/` keys among some messages' attachments (anything else is left alone). */
export function waMediaKeysOf(rows: { attachments?: unknown }[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const a of waAttachmentsOf(row.attachments)) {
      if (typeof a.key === 'string' && a.key.startsWith(WA_MEDIA_PREFIX)) {
        keys.add(a.key);
      }
    }
  }
  return [...keys];
}

/**
 * Delete stored WhatsApp files (retention and erasure, WA-A). Best effort, never throws: a file
 * that can't be deleted now is logged by the caller's count, and the reference still goes.
 */
export async function deleteWaMedia(
  s3:
    | {
        deleteObject(params: { bucket: string; key: string }): Promise<unknown>;
      }
    | undefined,
  bucket: string | undefined,
  keys: string[],
): Promise<number> {
  if (!s3 || !bucket || !keys.length) return 0;
  let deleted = 0;
  for (const key of keys) {
    try {
      await s3.deleteObject({ bucket, key });
      deleted += 1;
    } catch {
      // Left for the next sweep's report; the reference is cleared either way.
    }
  }
  return deleted;
}
