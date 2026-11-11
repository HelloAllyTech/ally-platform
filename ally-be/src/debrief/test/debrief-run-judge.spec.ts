import axios from 'axios';
import {
  DebriefRunJudgeService,
  RUN_JUDGE_INPUT_VERSION,
} from '../service/debrief-run-judge.service';

jest.mock('axios');

/**
 * The run judge sees the guidance the Writer was given — otherwise a protocol
 * is invisible to it and `contradicts_protocol` can never fire (plan case 17).
 */
describe('the run judge is given the Writer’s guidance', () => {
  const post = axios.post as jest.Mock;

  function build(chunks: Array<Record<string, unknown>>) {
    const query = jest.fn(async () => []);
    const find = jest.fn(async () => chunks);
    const svc = new DebriefRunJudgeService(
      { manager: { getRepository: () => ({ find }) }, query } as any,
      {
        transcript: jest.fn(async () => [
          { turn_index: 0, role: 'client', text: 'hi' },
        ]),
        loadSession: jest.fn(async () => ({
          language: 'en',
          learnerLevel: 'LAY',
        })),
        promptText: jest.fn(async () => null),
      } as any,
      { ai: { apiUrl: 'http://ai', outboundApiKey: 'k' } } as any,
    );
    return { svc, find };
  }

  const run = (passages?: string[]) =>
    ({
      id: 'r1',
      scenarioSessionId: 's1',
      language: 'en',
      cards: {
        lead: 'x',
        what_worked: [],
        work_on_this: [],
        practise_next: null,
      },
      workspace: passages ? { passages } : {},
    }) as any;

  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({
      data: {
        judge_model: 'm',
        judge_prompt_version: 'v3',
        dimensions: [{ dimension: 'accuracy', score: 9 }],
        hard_fails: [],
      },
    });
  });

  it('sends each passage the Writer saw, protocols labelled, in retrieval order', async () => {
    const { svc } = build([
      {
        id: 'b',
        statement: 'Refer weeks of low mood',
        body: 'Always refer.',
        facets: { kind: 'protocol' },
      },
      {
        id: 'a',
        statement: 'Name a missed feeling',
        body: 'Quote it.',
        facets: { kind: 'style_guide' },
      },
    ]);
    const j = await svc.judge(run(['a', 'b']), { store: false });
    const body = post.mock.calls[0][1];
    expect(body.guidance).toBe(
      'Name a missed feeling\nQuote it.\n\nORGANISATION PROTOCOL: Refer weeks of low mood\nAlways refer.',
    );
    expect(j!.promptVersion).toBe(`v3+${RUN_JUDGE_INPUT_VERSION}`);
  });

  it('sends no guidance when the run used none, without a lookup', async () => {
    const { svc, find } = build([]);
    await svc.judge(run(), { store: false });
    expect(post.mock.calls[0][1].guidance).toBeNull();
    expect(find).not.toHaveBeenCalled();
  });
});
