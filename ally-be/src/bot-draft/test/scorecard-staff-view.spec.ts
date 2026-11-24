import { ForbiddenException } from '@nestjs/common';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import { ScorecardService } from '../scorecard/scorecard.service';
import { topUnanswered } from '../scorecard/overview-suppression';

const STAFF = 50;
const MEMBER = 4;
let caller = STAFF;
let staffView: { chatbotId: string } | undefined;

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => caller,
    getTenantId: () => null,
    getExecutionId: () => undefined,
    getStaffView: () =>
      staffView && { ...staffView, staffUserId: caller, grantId: null },
  },
}));

const BOT = '00000000-0000-4000-8000-000000000001';
const ASKED = Array.from({ length: 6 }, (_, i) => ({
  text: 'Do you open on Sunday?',
  contactId: `c${i}`,
  reason: 'no_source',
}));

function make(grantLive: boolean, role = ChatbotMemberRole.EDITOR) {
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      if (
        /FROM wa_unanswered_questions q JOIN/.test(sql) &&
        /AS text/.test(sql)
      )
        return ASKED;
      if (/AS question/.test(sql)) return [{ id: 'q', question: 'secret?' }];
      if (/chatbot_message_feedback/.test(sql))
        return [{ id: 'f', reply: 'r', question: 'secret?' }];
      return [];
    }),
  };
  const access = new ChatbotAccessService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { liveGrant: async () => (grantLive ? { id: 'g' } : null) } as never,
  );
  // Members are checked as before: only editors and up pass.
  jest.spyOn(access, 'assert').mockImplementation(async (_id, need) => {
    if (need === ChatbotMemberRole.EDITOR && role === ChatbotMemberRole.VIEWER)
      throw new ForbiddenException();
    return {} as never;
  });
  const checkup = { latestFor: async () => null };
  const service = new ScorecardService(
    dataSource as never,
    access,
    checkup as never,
    {} as never,
    {} as never,
  );
  jest
    .spyOn(service as never, 'zoneOf')
    .mockResolvedValue('Asia/Kolkata' as never);
  jest.spyOn(service as never, 'days').mockResolvedValue([] as never);
  return service;
}

describe('overview and scorecard for Ally staff (read-only view)', () => {
  beforeEach(() => {
    caller = STAFF;
    staffView = { chatbotId: BOT };
  });

  it('topUnanswered with quote:false folds every question into themes', () => {
    const items = topUnanswered(ASKED, { quote: false });
    expect(items.every((i) => i.kind === 'theme')).toBe(true);
    expect(topUnanswered(ASKED).some((i) => i.kind === 'question')).toBe(true);
  });

  it('staff without a grant get the numbers but no verbatim question', async () => {
    const out = await make(false).overview(BOT, 30);
    expect(out.range).toBe(30);
    expect(out.topUnanswered.every((i) => i.kind === 'theme')).toBe(true);
    expect(JSON.stringify(out)).not.toContain('Sunday');
  });

  it('staff with a live grant see the quoted question', async () => {
    const out = await make(true).overview(BOT, 30);
    expect(out.topUnanswered.some((i) => i.kind === 'question')).toBe(true);
  });

  it('the scorecard hides open questions and thumbs-downs from staff without a grant', async () => {
    const out = await make(false).view(BOT);
    expect(out.unanswered).toEqual([]);
    expect(out.thumbsDown).toEqual([]);
    expect(out).toMatchObject({
      customerTextHidden: true,
      openCounts: { unanswered: 1, thumbsDown: 1 },
    });
    expect(JSON.stringify(out)).not.toContain('secret');
  });

  it('the scorecard shows them with a live grant', async () => {
    const out = await make(true).view(BOT);
    expect(out.unanswered).toHaveLength(1);
    expect(out.thumbsDown).toHaveLength(1);
    expect(out).not.toHaveProperty('customerTextHidden');
  });

  it('a member keeps quoted questions, and a viewer member still cannot open the overview', async () => {
    staffView = undefined;
    caller = MEMBER;
    const out = await make(false).overview(BOT, 7);
    expect(out.topUnanswered.some((i) => i.kind === 'question')).toBe(true);
    await expect(
      make(false, ChatbotMemberRole.VIEWER).overview(BOT, 7),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
