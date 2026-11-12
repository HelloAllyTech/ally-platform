/**
 * Splits a long WAV recording into smaller, independently-transcribable WAV
 * buffers, entirely in memory (no temp files — audio here is never written
 * to disk, see VoiceNoteService's own doc comment on why).
 *
 * Why this exists: VoiceNoteService used to send a whole dictation to
 * OpenAI's transcription API in one call. On longer recordings (observed
 * around 5-10+ minutes) that API can silently return a transcript truncated
 * near the end, with no error — a counsellor dictating a 5-10 minute note
 * would lose the last minute or two of what they said. Splitting into
 * shorter chunks first and transcribing each separately keeps every chunk
 * comfortably inside whatever undocumented limit causes that, and avoids it
 * entirely. Fixed 2026-11.
 */

export interface WavInfo {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  /** Byte offset into the buffer where the PCM samples start. */
  dataOffset: number;
  /** Length of the PCM sample data, in bytes (not including any header). */
  dataLength: number;
}

/**
 * Walks a WAV (RIFF/WAVE) buffer's chunk list to find `fmt ` and `data`.
 * Returns null for anything that isn't a well-formed, PCM-ish WAV file —
 * callers treat that as "don't chunk this, send it through as-is".
 */
export function parseWavHeader(buffer: Buffer): WavInfo | null {
  if (buffer.length < 44) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') return null;

  let offset = 12;
  let fmt: {
    numChannels: number;
    sampleRate: number;
    bitsPerSample: number;
  } | null = null;
  let dataOffset: number | null = null;
  let dataLength: number | null = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;
    if (chunkDataStart + chunkSize > buffer.length) break;

    if (chunkId === 'fmt ' && chunkSize >= 16) {
      fmt = {
        numChannels: buffer.readUInt16LE(chunkDataStart + 2),
        sampleRate: buffer.readUInt32LE(chunkDataStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkDataStart + 14),
      };
    } else if (chunkId === 'data') {
      dataOffset = chunkDataStart;
      dataLength = chunkSize;
    }

    // RIFF chunks are word-aligned: an odd-sized chunk carries one byte of
    // padding before the next chunk header.
    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (!fmt || dataOffset == null || dataLength == null) return null;
  if (fmt.numChannels <= 0 || fmt.sampleRate <= 0 || fmt.bitsPerSample <= 0)
    return null;
  return { ...fmt, dataOffset, dataLength };
}

export function wavDurationSeconds(info: WavInfo): number {
  const bytesPerSecond =
    info.sampleRate * info.numChannels * (info.bitsPerSample / 8);
  return bytesPerSecond > 0 ? info.dataLength / bytesPerSecond : 0;
}

/** A standalone 44-byte canonical PCM WAV header for `dataLength` bytes of audio shaped like `info`. */
function buildWavHeader(dataLength: number, info: WavInfo): Buffer {
  const header = Buffer.alloc(44);
  const blockAlign = info.numChannels * (info.bitsPerSample / 8);
  const byteRate = info.sampleRate * blockAlign;

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(info.numChannels, 22);
  header.writeUInt32LE(info.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(info.bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataLength, 40);
  return header;
}

/**
 * Splits a WAV buffer's PCM data into chunks of at most `chunkSeconds` each,
 * every chunk cut on a whole-sample boundary and returned as its own
 * standalone, valid WAV buffer. A buffer that isn't parseable as PCM WAV, or
 * is already no longer than `chunkSeconds`, is returned unchanged as the
 * only entry — chunking is strictly an opt-in safety measure for long
 * recordings, never a behaviour change for short ones.
 */
export function chunkWavBySeconds(
  buffer: Buffer,
  chunkSeconds: number,
): Buffer[] {
  const info = parseWavHeader(buffer);
  if (!info) return [buffer];

  const blockAlign = info.numChannels * (info.bitsPerSample / 8);
  if (blockAlign <= 0) return [buffer];
  if (wavDurationSeconds(info) <= chunkSeconds) return [buffer];

  const bytesPerChunk = Math.floor(info.sampleRate * chunkSeconds) * blockAlign;
  if (bytesPerChunk <= 0) return [buffer];

  const chunks: Buffer[] = [];
  for (let start = 0; start < info.dataLength; start += bytesPerChunk) {
    const end = Math.min(start + bytesPerChunk, info.dataLength);
    const pcm = buffer.subarray(info.dataOffset + start, info.dataOffset + end);
    chunks.push(Buffer.concat([buildWavHeader(pcm.length, info), pcm]));
  }
  return chunks;
}
