/**
 * Server-Sent Events over `fetch`, shared by the admin dashboard's streams (Preview, the roadmap
 * copilot) and the public bot page. No imports from the dashboard, so the bot page's bundle stays
 * small: callers bring their own `fetch` (with or without the admin token).
 */

export interface SseEvent {
  type: string;
  data: unknown;
}

/**
 * Parses complete SSE frames out of `buffer`, returning them plus the unconsumed remainder (a frame
 * still streaming in). Comment lines (`: ping`) are skipped; a frame whose data is not JSON is
 * dropped and reported to `onMalformed`.
 */
export const parseSse = (
  buffer: string,
  onMalformed?: (eventName: string) => void,
): { events: SseEvent[]; rest: string } => {
  const events: SseEvent[] = [];
  const frames = buffer.split(/\r?\n\r?\n/);
  const rest = frames.pop() ?? "";
  for (const frame of frames) {
    let eventName = "";
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!eventName || dataLines.length === 0) continue;
    try {
      events.push({ type: eventName, data: JSON.parse(dataLines.join("\n")) });
    } catch {
      onMalformed?.(eventName);
    }
  }
  return { events, rest };
};

/**
 * Reads a response body as SSE, calling `onEvent` for each event in order. `onEvent` returns
 * `true` to stop reading (the stream's last event, such as `final`); what it throws is rethrown.
 * Resolves with whether any event arrived and whether reading was stopped by `onEvent` (rather than
 * the stream simply ending).
 */
export async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => boolean | void,
  onMalformed?: (eventName: string) => void,
): Promise<{ started: boolean; stopped: boolean }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let started = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { started, stopped: false };
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSse(buffer, onMalformed);
    buffer = parsed.rest;
    for (const event of parsed.events) {
      started = true;
      if (onEvent(event) === true) {
        void reader.cancel().catch(() => undefined);
        return { started, stopped: true };
      }
    }
  }
}
