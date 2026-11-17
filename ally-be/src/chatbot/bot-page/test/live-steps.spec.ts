import { WaHandledBy } from '../../../whatsapp/enum/whatsapp.enum';
import { AgentRuntimeUsed } from '../../enum/chatbot.enum';
import type { ChatbotDecision } from '../../engine/chatbot-engine.types';
import { confirmedWrite, doneSteps, publicStep } from '../live-steps';

const BOOKING = '33333333-3333-4333-8333-333333333333';
const decision = (
  handledBy: WaHandledBy,
  runtime = AgentRuntimeUsed.V2,
): ChatbotDecision =>
  ({
    handledBy,
    body: 'Booked.',
    agent:
      runtime === AgentRuntimeUsed.V2
        ? {
            runtime,
            runId: 'run-1',
            conversationId: 'conv-1',
            trace: [],
            activity: [
              { kind: 'find', list: 'Slots' },
              {
                kind: 'create',
                list: 'Appointments',
                title: 'Thu 19 Nov 2026, 11:00',
                record_id: BOOKING,
              },
            ],
          }
        : {
            runtime,
            runId: 'run-1',
            conversationId: 'conv-1',
            fallbackReason: 'timeout',
          },
  }) as unknown as ChatbotDecision;

describe('the bot page live steps (chunk 6b)', () => {
  it('a step is a kind and at most a list name or a day and time', () => {
    expect(publicStep({ kind: 'search' })).toEqual({ kind: 'search' });
    expect(publicStep({ kind: 'find', list: 'Free times' })).toEqual({
      kind: 'find',
      label: 'Free times',
    });
    expect(
      publicStep({
        kind: 'find',
        list: '33333333-3333-4333-8333-333333333333',
      }),
    ).toEqual({ kind: 'find' });
    expect(publicStep({ kind: 'hand_over', list: 'x' })).toEqual({
      kind: 'hand_over',
    });
  });

  it('"what I did" for an answer, never for crisis, Safety, a template or v1', () => {
    expect(doneSteps(decision(WaHandledBy.RAG))).toEqual([
      { kind: 'find', label: 'Slots' },
      { kind: 'create', label: 'Thu 19 Nov 2026, 11:00' },
    ]);
    for (const handledBy of [
      WaHandledBy.CRISIS,
      WaHandledBy.TEMPLATE,
      WaHandledBy.CONSENT,
      WaHandledBy.HUMAN,
    ]) {
      expect(doneSteps(decision(handledBy))).toEqual([]);
      expect(confirmedWrite(decision(handledBy))).toBeNull();
    }
    expect(
      doneSteps(decision(WaHandledBy.RAG, AgentRuntimeUsed.V2_FALLBACK)),
    ).toEqual([]);
  });

  it('the card is for the last write with a record', () => {
    expect(confirmedWrite(decision(WaHandledBy.RAG))?.record_id).toBe(BOOKING);
  });
});
