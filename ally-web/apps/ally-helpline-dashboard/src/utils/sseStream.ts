/**
 * Server-sent events over `fetch`, for streams that need an Authorization
 * header (EventSource can't send one). Shared by the character interview and
 * the Ally guide.
 */

export interface SseFrame {
  /** The `event:` field, or null when the frame has none. */
  event: string | null;
  /** The `id:` field, or null. Only durable guide events carry one. */
  id: string | null;
  /** `data:` lines joined with "\n". */
  data: string;
}

/**
 * Splits `buffer` into complete frames plus the unconsumed remainder (a frame
 * still streaming in). Comment lines (`:`) and other fields (`retry:`) are
 * ignored; a frame with no `data:` line is dropped.
 */
export const parseSseFrames = (buffer: string): { frames: SseFrame[]; rest: string } => {
  const chunks = buffer.split(/\r?\n\r?\n/);
  const rest = chunks.pop() ?? "";
  const frames: SseFrame[] = [];

  for (const chunk of chunks) {
    let event: string | null = null;
    let id: string | null = null;
    const dataLines: string[] = [];
    for (const line of chunk.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      else if (line.startsWith("id:")) id = line.slice(3).trim();
    }
    if (dataLines.length === 0) continue;
    frames.push({ event, id, data: dataLines.join("\n") });
  }

  return { frames, rest };
};

/**
 * Reads an SSE body to its end, calling `onFrame` for each complete frame.
 * Resolves when the server closes the stream; rejects if the read fails
 * (including when `signal` aborts the fetch).
 */
export const readSseStream = async (
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: SseFrame) => void,
): Promise<void> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = parseSseFrames(buffer);
      buffer = rest;
      for (const frame of frames) onFrame(frame);
    }
  } finally {
    reader.releaseLock();
  }
};

export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 15_000;

/**
 * Reconnect delay for the `attempt`-th consecutive failure (1-based):
 * exponential, capped at 15 s, with full jitter and a 1 s floor, so a fleet
 * of clients dropped by one deploy doesn't return in lockstep (plan §7.10).
 */
export const reconnectDelay = (attempt: number, random: () => number = Math.random): number => {
  const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(RECONNECT_MIN_MS + random() * (ceiling - RECONNECT_MIN_MS));
};
