import type { Response } from 'express';

/**
 * Server-Sent Events on an Express response, as the chatbot test stream writes them: headers go
 * out with the first event (so a refusal before it is still a plain HTTP error), a comment line
 * every 10 s keeps proxies from closing a quiet stream, and nothing is written after the client
 * has gone.
 */
export class SseWriter {
  private heartbeat?: NodeJS.Timeout;
  readonly closed = new AbortController();

  constructor(private readonly res: Response) {
    res.on('close', () => {
      if (!res.writableEnded) this.closed.abort();
      clearInterval(this.heartbeat);
    });
  }

  get started(): boolean {
    return this.res.headersSent;
  }

  send(event: string, data: unknown): void {
    if (this.closed.signal.aborted || this.res.writableEnded) return;
    if (!this.res.headersSent) {
      this.res.setHeader('Content-Type', 'text/event-stream');
      this.res.setHeader('Cache-Control', 'no-cache');
      this.res.setHeader('Connection', 'keep-alive');
      this.res.setHeader('X-Accel-Buffering', 'no');
      this.res.flushHeaders();
      this.heartbeat = setInterval(() => this.res.write(': ping\n\n'), 10_000);
    }
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  end(): void {
    clearInterval(this.heartbeat);
    if (this.res.headersSent && !this.res.writableEnded) this.res.end();
  }
}
