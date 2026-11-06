import type { CrisisCheckResponse } from '../../ai/dto/knowledge.dto';
import type { LiveReply } from './chatbot-engine.types';

/**
 * A live reply whose text waits for the crisis check. Status and steps pass at once; `token`s are
 * held until the check has cleared the message, then sent in order, and later ones pass straight
 * through. On a crisis verdict the held text is dropped and no more is sent: the crisis reply
 * arrives as `final` and is the only text the person sees.
 *
 * A classifier that failed or is switched off counts as cleared, as it does for the reply itself.
 */
export function holdTextUntilCleared(
  live: LiveReply,
  crisisCheck: Promise<CrisisCheckResponse | null>,
): LiveReply {
  let state: 'holding' | 'cleared' | 'crisis' = 'holding';
  const held: Parameters<LiveReply['onEvent']>[0][] = [];
  const clear = () => {
    state = 'cleared';
    for (const event of held.splice(0)) live.onEvent(event);
  };
  crisisCheck.then((verdict) => {
    if (verdict?.is_crisis) {
      state = 'crisis';
      held.length = 0;
    } else {
      clear();
    }
  }, clear);
  return {
    signal: live.signal,
    onEvent(event) {
      if (event.event !== 'token' || state === 'cleared') live.onEvent(event);
      else if (state === 'holding') held.push(event);
    },
  };
}
