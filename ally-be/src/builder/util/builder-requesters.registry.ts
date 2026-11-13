/**
 * Requesters: modules that ask Builder for work on an agent's behalf (plan §11.5).
 *
 * A session created with `requestedBy` is the requester's. When one of its interview
 * turns ends, Builder tells the requester registered under that name, which may answer
 * Builder's pending question itself (through `BuilderDecisionService.answer`, exactly as a
 * person answering from the feed) or leave it for a person. Builder imports nothing from
 * the requester: the requester registers itself at module init, so the dependency points
 * one way only, as with the roadmap's hand-off.
 *
 * Fire-and-forget: a requester that fails never touches the turn that just ended.
 */
export interface BuilderRequester {
  turnEnded(sessionId: string, requestRef: string | null): Promise<void>;
}

/** The only requester today: "Hand to Builder" on a Debrief PM agent idea. */
export const DEBRIEF_PM_AGENT_REQUESTER = 'debrief_pm_agent';

class BuilderRequesterRegistry {
  private readonly requesters = new Map<string, BuilderRequester>();

  register(name: string, requester: BuilderRequester): void {
    this.requesters.set(name, requester);
  }

  get(name: string | null | undefined): BuilderRequester | null {
    return name ? (this.requesters.get(name) ?? null) : null;
  }

  /** For specs. */
  clear(): void {
    this.requesters.clear();
  }
}

export const builderRequesters = new BuilderRequesterRegistry();
