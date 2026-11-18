/**
 * A read that failed and was answered with a fallback so the debrief could go on. Each is logged
 * and ends up in `workspace.dataNotes` (same shape as the data providers' notes), so a run that
 * read less than it should says so instead of looking like any other.
 */
export interface DegradedNote {
  contextKey: string;
  item: string | null;
  why: string;
}

export class Degraded {
  readonly notes: DegradedNote[] = [];

  constructor(private readonly log?: { warn: (message: string) => void }) {}

  note(contextKey: string, item: string | null, error: unknown): void {
    const why =
      (error as Error)?.message?.toString().slice(0, 200) ||
      'could not be read';
    this.notes.push({ contextKey, item, why });
    this.log?.warn(
      `[debrief] ${contextKey} could not be read, used a fallback: ${why}`,
    );
  }

  /** Reads, and on failure notes it and answers with the fallback. */
  async or<T>(
    contextKey: string,
    item: string | null,
    read: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await read();
    } catch (e) {
      this.note(contextKey, item, e);
      return fallback;
    }
  }
}
