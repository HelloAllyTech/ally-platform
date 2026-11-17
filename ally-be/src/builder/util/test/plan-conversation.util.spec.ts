import { BuilderMessageRole } from '../../enum/builder.enum';
import { questionStates, renderPlanBatch } from '../plan-conversation.util';

let seq = 0;
const at = new Date('2026-11-17T10:00:00Z');
const ask = (id = 'q1', prompt = 'Which learners first?') =>
  ({
    id: `a${++seq}`,
    seq,
    role: BuilderMessageRole.ASSISTANT,
    content: 'Question',
    metadata: { questions: [{ id, prompt, kind: 'single' }] },
    createdAt: at,
  }) as any;
const post = (
  kind: 'answer' | 'comment' | 'settled',
  by: { id: number; name: string; relation: string },
  text: string,
  extra: Record<string, unknown> = {},
) =>
  ({
    id: `p${++seq}`,
    seq,
    role: BuilderMessageRole.USER,
    content: text,
    metadata: {
      planPost: { kind, by: { role: 'idea', ...by }, ...extra },
      idempotencyKey: `key-${seq}-xxxx`,
    },
    createdAt: at,
  }) as any;
const lead = (batch: { text: string; postIds: string[] }) =>
  ({
    id: `l${++seq}`,
    seq,
    role: BuilderMessageRole.USER,
    content: 'Continue',
    metadata: { planBatch: batch },
    createdAt: at,
  }) as any;

const RAVI = { id: 1, name: 'Ravi', relation: 'author' };
const ASHA = { id: 2, name: 'Asha', relation: 'idea' };
const PRIYA = { id: 3, name: 'Priya', relation: 'lead' };

describe('plan conversation', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('attributes answers and labels comments as context, never answers', () => {
    const history = [
      ask(),
      post('answer', RAVI, 'New learners', { questionId: 'q1' }),
      post('comment', ASHA, '@Ravi did you check analytics?'),
    ];
    const batch = renderPlanBatch(history, { name: 'Ravi' })!;
    expect(batch.text).toContain(
      '[Ravi · author] answered "Which learners first?": New learners',
    );
    expect(batch.text).toContain('not answers to your questions');
    expect(batch.text).toContain(
      '[Asha · idea]: @Ravi did you check analytics?',
    );
    expect(batch.postIds).toEqual([history[1].id, history[2].id]);
  });

  it('agreement is not a conflict; the same words twice is one answer', () => {
    const history = [
      ask(),
      post('answer', RAVI, 'New learners', { questionId: 'q1' }),
      post('answer', ASHA, ' new  LEARNERS ', { questionId: 'q1' }),
    ];
    expect(questionStates(history)[0].conflict).toBe(false);
  });

  it('holds conflicting answers back, words and all, and says who is choosing', () => {
    const history = [
      ask(),
      post('answer', RAVI, 'New learners', { questionId: 'q1' }),
      post('answer', ASHA, 'Supervisors', { questionId: 'q1' }),
    ];
    const [state] = questionStates(history);
    expect(state.conflict).toBe(true);
    const batch = renderPlanBatch(history, { name: 'Priya' })!;
    expect(batch.text).toContain('answered differently. Priya is choosing');
    expect(batch.text).not.toContain('New learners');
    expect(batch.text).not.toContain('Supervisors');
    expect(batch.postIds).toEqual([]);
  });

  it("hands over the settler's choice, then counts the question as batched", () => {
    const history = [
      ask(),
      post('answer', RAVI, 'New learners', { questionId: 'q1' }),
      post('answer', ASHA, 'Supervisors', { questionId: 'q1' }),
    ];
    history.push(
      post('settled', PRIYA, 'Supervisors', {
        questionId: 'q1',
        chosenPostId: history[2].id,
      }),
    );
    const [state] = questionStates(history);
    expect(state).toMatchObject({
      conflict: false,
      chosenPostId: history[2].id,
      settledBy: expect.objectContaining({ name: 'Priya' }),
    });
    const batch = renderPlanBatch(history, { name: 'Priya' })!;
    expect(batch.text).toContain(
      `[Priya · lead] chose [Asha · idea]'s answer to "Which learners first?": Supervisors`,
    );
    history.push(lead(batch));
    expect(questionStates(history)[0].batched).toBe(true);
    expect(renderPlanBatch(history, { name: 'Priya' })).toBeNull();
  });

  it("a person's later answer replaces their earlier one", () => {
    const history = [
      ask(),
      post('answer', RAVI, 'New learners', { questionId: 'q1' }),
      post('answer', ASHA, 'Supervisors', { questionId: 'q1' }),
      post('answer', RAVI, 'Supervisors', { questionId: 'q1' }),
    ];
    const [state] = questionStates(history);
    expect(state.answers).toHaveLength(2);
    expect(state.conflict).toBe(false);
  });
});
