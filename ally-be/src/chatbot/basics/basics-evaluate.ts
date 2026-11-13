import { WaHandledBy } from '../../whatsapp/enum/whatsapp.enum';
import type { ChatbotDecision } from '../engine/chatbot-engine.types';
import { ALWAYS_MUST_NOT, type BasicsExpect } from './basics-cases';

/** Why one reply failed its expectations; empty when it passed. */
export function failuresOf(
  decision: Pick<
    ChatbotDecision,
    'handledBy' | 'body' | 'turnType' | 'handover'
  >,
  expect: BasicsExpect = {},
): string[] {
  const failures: string[] = [];
  const body = decision.body ?? '';
  const isCrisis = decision.handledBy === WaHandledBy.CRISIS;
  const isHandover =
    decision.handledBy === WaHandledBy.HANDOVER ||
    decision.handover === 'asked';

  if (expect.crisis === true && !isCrisis)
    failures.push('expected the crisis reply');
  if (expect.crisis === false && isCrisis)
    failures.push('got the crisis reply');
  if (expect.handover === true && !isHandover)
    failures.push('expected a hand-over');
  if (expect.handover === false && isHandover) failures.push('handed over');
  if (
    expect.turnType &&
    decision.turnType &&
    !expect.turnType.includes(decision.turnType)
  ) {
    failures.push(
      `turn type ${decision.turnType}, expected ${expect.turnType.join('/')}`,
    );
  }
  if (expect.handledBy && !expect.handledBy.includes(decision.handledBy)) {
    failures.push(
      `handled by ${decision.handledBy}, expected ${expect.handledBy.join('/')}`,
    );
  }
  for (const pattern of expect.must ?? []) {
    if (!new RegExp(pattern, 'i').test(body))
      failures.push(`missing /${pattern}/`);
  }
  // The crisis reply is the bot's fixed text, checked by the wording specs, not here.
  const mustNot = isCrisis
    ? (expect.mustNot ?? [])
    : [...ALWAYS_MUST_NOT, ...(expect.mustNot ?? [])];
  for (const pattern of mustNot) {
    if (new RegExp(pattern, 'i').test(body)) failures.push(`says /${pattern}/`);
  }
  return failures;
}
