import { AsyncLocalStorage } from 'async_hooks';
import type { SafetyPack } from './safety-packs';

/**
 * Stage 9: the released safety packs, held in memory so `packFor` (synchronous, called on every
 * engine turn) can read them without a query. `SafetyPackReleaseService` fills it on boot,
 * refreshes it on a short timer, and refreshes it at once after a release or rollback on this
 * instance. Empty (releases switched off, nothing loaded yet, or a unit test) means every pack is
 * read from the code constants, which is exactly the behaviour before stage 9.
 */
export interface LivePackEntry {
  releaseId: string;
  version: number;
  pack: SafetyPack;
}

let live = new Map<string, LivePackEntry>();

export function setLivePacks(entries: LivePackEntry[]): void {
  live = new Map(entries.map((entry) => [entry.pack.id, entry]));
}

export function clearLivePacks(): void {
  live = new Map();
}

export function livePack(id: string): LivePackEntry | undefined {
  return live.get(id);
}

/**
 * The seam for testing a draft release (stage 9): inside `withPackOverride`, `packFor(packId)`
 * returns the draft content, and the engine's knowledge request uses this pack whatever pack the
 * test chatbot has. Async-local, so only the suite's own runs see it.
 */
export interface PackOverride {
  packId: string;
  pack: SafetyPack;
}

const overrideStore = new AsyncLocalStorage<PackOverride>();

export function withPackOverride<T>(override: PackOverride, fn: () => T): T {
  return overrideStore.run(override, fn);
}

export function packOverride(): PackOverride | undefined {
  return overrideStore.getStore();
}
