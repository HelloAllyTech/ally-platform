import type { CrisisCheckResponse } from '../../../ai/dto/knowledge.dto';
import type { LiveReply } from '../chatbot-engine.types';
import { FINAL_ONLY_PACKS, holdTextUntilCleared } from '../live-reply';

type Event = Parameters<LiveReply['onEvent']>[0];

/** TF1 round 2 (Saathi B-1): what a person sees while a reply is being written. */
describe('the live reply', () => {
  const token = (text: string) => ({ event: 'token', data: { text } }) as Event;
  const status = { event: 'status', data: { code: 'thinking' } } as Event;
  const activity = { event: 'activity', data: { kind: 'find' } } as Event;

  function gate(options: { finalOnly?: boolean } = {}) {
    let settle!: (v: CrisisCheckResponse | null) => void;
    const check = new Promise<CrisisCheckResponse | null>((r) => (settle = r));
    const seen: Event[] = [];
    const live = holdTextUntilCleared(
      { onEvent: (e) => seen.push(e) },
      check,
      options,
    );
    return { live, seen, settle };
  }
  const none = {
    is_crisis: false,
    level: 'none',
    confidence: 0,
    signal: '',
  } as CrisisCheckResponse;
  const tick = () => new Promise((r) => setImmediate(r));

  it('every assistant: text waits for the crisis verdict, then goes out in order', async () => {
    const { live, seen, settle } = gate();
    live.onEvent(status);
    live.onEvent(token('Hi '));
    live.onEvent(token('Asha'));
    expect(seen).toEqual([status]);
    settle(none);
    await tick();
    expect(seen).toEqual([status, token('Hi '), token('Asha')]);
    live.onEvent(token('!'));
    expect(seen[seen.length - 1]).toEqual(token('!'));
  });

  it('a crisis: nothing held is ever shown', async () => {
    const { live, seen, settle } = gate();
    live.onEvent(token('Some draft'));
    settle({ ...none, is_crisis: true, level: 'at_risk' });
    await tick();
    live.onEvent(token('more'));
    expect(seen).toEqual([]);
  });

  it('a safety-pack assistant: no draft text at all, but status and steps pass', async () => {
    const { live, seen, settle } = gate({ finalOnly: true });
    live.onEvent(status);
    live.onEvent(token('Hi Asha'));
    live.onEvent(activity);
    settle(none);
    await tick();
    live.onEvent(token(' more'));
    expect(seen).toEqual([status, activity]);
  });

  it('an upset turn becomes final-only when the verdict says so', async () => {
    const { live, seen, settle } = gate();
    live.onEvent(token('Draft'));
    settle({ ...none, level: 'upset' });
    await tick();
    live.onEvent(token(' more'));
    expect(seen.filter((e) => e.event === 'token')).toEqual([]);
  });

  it('the packs that never show a draft', () => {
    expect([...FINAL_ONLY_PACKS].sort()).toEqual([
      'medical',
      'mental_health',
      'pharmacy',
    ]);
  });
});
