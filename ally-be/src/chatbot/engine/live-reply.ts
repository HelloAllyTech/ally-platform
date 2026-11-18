import type { CrisisCheckResponse } from '../../ai/dto/knowledge.dto';
import type { LiveReply } from './chatbot-engine.types';

/**
 * A live reply whose text waits for the crisis check. Status and steps pass at once; `token`s and
 * `activity` (the bot page's live steps, chunk 6b) are held until the check has cleared the
 * message, then sent in order, and later ones pass straight through. On a crisis verdict the held
 * ones are dropped and no more are sent: the crisis reply arrives as `final`, whole, with no
 * steps, and is the only text the person sees.
 *
 * A classifier that failed or is switched off counts as cleared, as it does for the reply itself.
 */
export function holdTextUntilCleared(
  live: LiveReply,
  crisisCheck: Promise<CrisisCheckResponse | null>,
): LiveReply {
  let state: 'holding' | 'cleared' | 'crisis' = 'holding';
  const waiting: Parameters<LiveReply['onEvent']>[0][] = [];
  const clear = () => {
    state = 'cleared';
    for (const event of waiting.splice(0)) live.onEvent(event);
  };
  crisisCheck.then((verdict) => {
    if (verdict?.is_crisis) {
      state = 'crisis';
      waiting.length = 0;
    } else {
      clear();
    }
  }, clear);
  return {
    signal: live.signal,
    onEvent(event) {
      const held = event.event === 'token' || event.event === 'activity';
      if (!held || state === 'cleared') live.onEvent(event);
      else if (state === 'holding') waiting.push(event);
    },
  };
}
