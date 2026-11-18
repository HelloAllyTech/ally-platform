import { ToolMessage } from 'langchain';
import {
  createDatalyzeTaskTokenMiddleware,
  extractTaskToken,
  TASK_TOKEN_PLACEHOLDER,
} from '../datalyze-task-token.util';

// Placeholders, not real tokens: anything without whitespace or backticks will do.
const FIRST_TASK = 'fake-task-token-one.fake-signature-one';
const SECOND_TASK = 'fake-task-token-two.fake-signature-two';

const result = (text: string) =>
  new ToolMessage({ content: text, tool_call_id: 'x' });

type Handler = (request: any) => Promise<ToolMessage>;

function setup() {
  const middleware = createDatalyzeTaskTokenMiddleware() as any;
  const seen: any[] = [];
  const respond = (reply: ToolMessage): Handler =>
    jest.fn(async (request: any) => {
      seen.push(request.toolCall);
      return reply;
    });
  const call = (name: string, args: Record<string, unknown>, h: Handler) =>
    middleware.wrapToolCall({ toolCall: { name, args, id: 'c' } }, h);
  return { call, respond, seen };
}

describe('extractTaskToken', () => {
  it('reads the token from a text result', () => {
    expect(
      extractTaskToken(`Do this step.\n\ntask: \`${FIRST_TASK}\`\n\nmore`),
    ).toBe(FIRST_TASK);
  });

  it('reads it from content blocks', () => {
    expect(
      extractTaskToken([{ type: 'text', text: `task: \`${SECOND_TASK}\`` }]),
    ).toBe(SECOND_TASK);
  });

  it('returns null when there is none', () => {
    expect(extractTaskToken('No token here')).toBeNull();
    expect(extractTaskToken(undefined)).toBeNull();
  });
});

describe('createDatalyzeTaskTokenMiddleware', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  it('puts the newest token into every next_step call, whatever the model sent', async () => {
    const { call, respond, seen } = setup();
    await call(
      'datalyze_start_any_analytics_question_metrics_retention_funnels_tracking',
      { request: 'q' },
      respond(result(`task: \`${FIRST_TASK}\``)),
    );
    await call(
      'datalyze_next_step',
      { task: TASK_TOKEN_PLACEHOLDER, report: 'r' },
      respond(result(`task: \`${SECOND_TASK}\``)),
    );
    await call(
      'datalyze_next_step',
      { task: 'a-mangled-copy-of-the-token', report: 'r2' },
      respond(result('complete')),
    );
    expect(seen[1].args).toEqual({ task: FIRST_TASK, report: 'r' });
    expect(seen[2].args).toEqual({ task: SECOND_TASK, report: 'r2' });
  });

  it('keeps the last token when a call fails and returns no new one', async () => {
    const { call, respond, seen } = setup();
    await call(
      'datalyze_start_task',
      {},
      respond(result(`task: \`${FIRST_TASK}\``)),
    );
    await call(
      'datalyze_next_step',
      { task: TASK_TOKEN_PLACEHOLDER },
      respond(result('`fields.checklist` needs one line for every item')),
    );
    await call(
      'datalyze_next_step',
      { task: TASK_TOKEN_PLACEHOLDER },
      respond(result('done')),
    );
    expect(seen[2].args.task).toBe(FIRST_TASK);
  });

  it('leaves the call alone before any token exists, and other tools alone', async () => {
    const { call, respond, seen } = setup();
    await call(
      'datalyze_next_step',
      { task: 'whatever-it-had' },
      respond(result('x')),
    );
    await call(
      'datalyze_search_knowledge',
      { query: 'q' },
      respond(result('x')),
    );
    await call(
      'github_get_file_contents',
      { path: 'p' },
      respond(result(`task: \`${SECOND_TASK}\``)),
    );
    await call(
      'datalyze_next_step',
      { task: 'still-mine' },
      respond(result('x')),
    );
    expect(seen[0].args.task).toBe('whatever-it-had');
    expect(seen[3].args.task).toBe('still-mine');
  });

  it('does not share a token between runs', async () => {
    const a = setup();
    const b = setup();
    await a.call(
      'datalyze_start_task',
      {},
      a.respond(result(`task: \`${FIRST_TASK}\``)),
    );
    await b.call(
      'datalyze_next_step',
      { task: 'b-own' },
      b.respond(result('x')),
    );
    expect(b.seen[0].args.task).toBe('b-own');
  });
});
