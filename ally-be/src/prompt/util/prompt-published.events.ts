/**
 * "A prompt version went live" — published from the Skills Store dashboard,
 * the `prompts` CLI, a revert, an experiment's Apply or the code sync. Other
 * modules subscribe without the prompt module importing them (the Debrief
 * agent makes a release from it: plan §8.8). Listeners run after the publish
 * has committed and never affect it: a listener that throws is logged and
 * ignored.
 */
export interface PromptPublishedEvent {
  promptId: string;
  promptCode: string;
  version: number;
  previousVersion: number | null;
  /** The version's author (`prompts_versions.createdBy`); 0 or null for a system write. */
  createdBy: number | null;
  /** `PromptVersionSource`: dashboard, cli, sync, revert, experiment, builder, import, … */
  source: string | null;
  /** The version's publish note / changelog, when one was written. */
  note: string | null;
}

type Listener = (e: PromptPublishedEvent) => Promise<void> | void;

const listeners: Listener[] = [];

export function onPromptPublished(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    const at = listeners.indexOf(listener);
    if (at >= 0) listeners.splice(at, 1);
  };
}

export async function emitPromptPublished(
  e: PromptPublishedEvent,
  onError: (err: Error) => void = () => undefined,
): Promise<void> {
  for (const l of [...listeners]) {
    try {
      await l(e);
    } catch (err) {
      onError(err as Error);
    }
  }
}
