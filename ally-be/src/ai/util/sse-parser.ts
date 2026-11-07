/** One Server-Sent Event: its `event:` name and its `data:` lines joined. */
export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Splits a Server-Sent Events byte stream into messages as chunks arrive. A message may be cut
 * anywhere between chunks, so the unfinished tail is kept for the next push. Comment lines (`: ping`)
 * and messages without data are skipped.
 */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const blocks = this.buffer.split(/\r?\n\r?\n/);
    this.buffer = blocks.pop() ?? '';
    const messages: SseMessage[] = [];
    for (const block of blocks) {
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (!line || line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        const value =
          colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      }
      if (data.length) messages.push({ event, data: data.join('\n') });
    }
    return messages;
  }
}
