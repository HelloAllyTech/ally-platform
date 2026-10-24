import { SessionItemStatus } from 'src/common/type/common.type';
import { AgentStreamEvent } from 'src/llm-agent/type/agent-llm.type';
import { TrackItemType } from 'src/track/type/track.type';
import { GuidePlaygroundService } from '../guide-playground.service';
import { buildCourseSpine } from '../../conductor/course-spine';
import { GUIDE_DEFAULT_BUNDLE } from '../../release/guide-release.bundle';
import { DEFAULT_CRISIS_TEXT } from '../../safety/fixed-responses';
import { CLEAR_VERDICT, keywordVerdict } from '../../safety/sentinel';
import { matchFirstPersonRisk } from 'src/common/safety/first-person-risk.matcher';

const spine = buildCourseSpine({
  id: 'tr1',
  title: 'Course',
  enrolled: true,
  sections: [
    {
      id: 's1',
      title: 'One',
      order: 1,
      items: [
        {
          id: 'i1',
          type: TrackItemType.ARTICLE,
          order: 1,
          title: 'Listening',
          status: SessionItemStatus.UNLOCKED,
        },
        {
          id: 'i2',
          type: TrackItemType.QUIZ,
          order: 2,
          title: 'Check',
          status: SessionItemStatus.LOCKED,
        },
      ],
    },
  ],
});
const course = {
  title: 'Course',
  description: null,
  languageCode: 'en',
  trainerNotes: null,
  spine,
};

const final = (content: any[], stopReason = 'end_turn'): AgentStreamEvent =>
  ({
    type: 'final',
    message: {
      content,
      stopReason,
      usage: { inputTokens: 10, outputTokens: 5 },
    },
  }) as AgentStreamEvent;

function setup(passes: AgentStreamEvent[][]) {
  const requests: any[] = [];
  const models = {
    route: jest.fn(() => ({ provider: 'anthropic', model: 'claude-opus-5-5' })),
    stream: jest.fn(async function* (call: any) {
      requests.push(call);
      call.onCost?.(0.01);
      for (const event of passes.shift() ?? [
        final([{ type: 'text', text: 'Hi.' }]),
      ]) {
        yield event;
      }
    }),
  };
  const sentinel = {
    assess: jest.fn(async ({ text }: { text: string }) => {
      const hit = matchFirstPersonRisk(text);
      return hit
        ? keywordVerdict(hit, 0)
        : { ...CLEAR_VERDICT, source: 'classifier', latencyMs: 1 };
    }),
  };
  const conductor = {
    loadPreviewCourse: jest.fn(async () => course),
    loadPublicCourse: jest.fn(async () => ({
      ...course,
      spine: { ...spine, enrolled: false },
    })),
  };
  const tutor = { consult: jest.fn() };
  const orgProfiles = { findOne: jest.fn(async () => null) };
  const service = new GuidePlaygroundService(
    {
      getById: jest.fn(async () => ({
        id: 'rel-d',
        version: 5,
        status: 'draft',
        bundle: GUIDE_DEFAULT_BUNDLE,
      })),
    } as never,
    conductor as never,
    models as never,
    sentinel as never,
    tutor as never,
    orgProfiles as never,
  );
  return { service, requests, conductor, tutor };
}

describe('GuidePlaygroundService', () => {
  it('runs a draft for real, with write tools as dry runs that keep the course rules', async () => {
    const t = setup([
      [
        final(
          [
            {
              type: 'tool_use',
              id: 'tu1',
              name: 'present_course_item',
              input: { item_id: 'i2', reason: 'learner_asked', framing: 'x' },
            },
          ],
          'tool_use',
        ),
      ],
      [final([{ type: 'text', text: 'That one opens after the article.' }])],
    ]);
    const result = await t.service.run({
      releaseId: 'rel-d',
      trackId: 'tr1',
      message: 'Can I take the quiz?',
      progress: 0,
    });
    expect(result.release).toMatchObject({ version: 5, status: 'draft' });
    expect(result.reply).toBe('That one opens after the article.');
    expect(result.toolCalls[0]).toMatchObject({
      name: 'present_course_item',
      isError: true,
      simulated: true,
    });
    expect(result.situation).toContain('<situation_report');
    expect(result.costUsd).toBeGreaterThan(0);
    // Charged to no learner and no organisation.
    expect(t.requests[0].attribution).toMatchObject({
      userId: null,
      tenantId: null,
      threadId: null,
    });
    expect(t.conductor.loadPreviewCourse).toHaveBeenCalledWith('tr1', 0);
  });

  it('gives the fixed crisis response without calling the orchestrator', async () => {
    const t = setup([]);
    const result = await t.service.run({
      releaseId: 'rel-d',
      trackId: 'tr1',
      message: 'I want to end my life',
    });
    expect(result.replyKind).toBe('crisis');
    expect(result.reply).toBe(DEFAULT_CRISIS_TEXT);
    expect(t.requests).toHaveLength(0);
  });

  it('as a visitor, offers only the visitor tools on the public outline', async () => {
    const t = setup([[final([{ type: 'text', text: 'It is short.' }])]]);
    await t.service.run({
      releaseId: 'rel-d',
      trackId: 'tr1',
      message: 'What is this?',
      visitor: true,
    });
    expect(t.conductor.loadPublicCourse).toHaveBeenCalled();
    expect(
      t.requests[0].request.tools.map((tool: any) => tool.name).sort(),
    ).toEqual([
      'search_library',
      'show_course_info',
      'show_wellbeing_resources',
      'suggest_sign_in',
    ]);
  });
});
