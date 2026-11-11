import { BotPageAccess, BotPageAccessKind } from '../../enum/bot-page.enum';
import {
  ChatbotAccessMode,
  ChatbotAudienceKind,
} from '../../enum/chatbot.enum';
import { ChatbotAudienceService } from '../../service/chatbot-audience.service';
import { BotPageAccessService } from '../bot-page-access.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

const ORG = '6f9c1a52-1111-4a8e-9a0c-1b2c3d4e5f60';

/**
 * The approval's condition (Shehbaz, 2026-11-07): a bot page setting can never widen who may chat
 * on WhatsApp. The page keeps its list in `chatbot_page_access`; `canChat` reads `chatbot_audience`
 * only. Here both lists live in one in-memory table set, and adding the same email and organisation
 * to the page leaves every WhatsApp verdict exactly as it was.
 */
describe('a bot page’s access list never widens WhatsApp access', () => {
  const tables = {
    chatbot_audience: [
      {
        chatbotId: 'bot-1',
        kind: ChatbotAudienceKind.PHONE,
        value: '+919820012345',
      },
    ],
    chatbot_page_access: [] as {
      pageId: string;
      kind: string;
      value: string;
    }[],
  };
  const audience = new ChatbotAudienceService({
    find: jest.fn(async ({ where }) =>
      tables.chatbot_audience.filter((r) => r.chatbotId === where.chatbotId),
    ),
  } as never);
  const pageAccess = new BotPageAccessService(
    {
      createQueryBuilder: () => {
        let rows: { pageId: string; kind: string; value: string }[] = [];
        const builder = {
          insert: () => builder,
          into: () => builder,
          values: (v: typeof rows) => ((rows = v), builder),
          orIgnore: () => builder,
          returning: () => builder,
          execute: async () => {
            tables.chatbot_page_access.push(...rows);
            return { raw: rows };
          },
        };
        return builder;
      },
    } as never,
    {} as never,
  );

  const senders = [
    {
      externalId: '+919820012345',
      label: 'listed phone',
      phone: '+919820012345',
    },
    { externalId: 'asha', label: 'invited email', email: 'asha@example.com' },
    { externalId: 'ravi', label: 'org member', tenantId: ORG, userId: 42 },
    { externalId: 'x', label: 'stranger' },
  ];
  const modes = [
    ChatbotAccessMode.ANYONE,
    ChatbotAccessMode.RECOGNISED,
    ChatbotAccessMode.LISTED,
  ];

  const verdicts = () =>
    Promise.all(
      modes.flatMap((accessMode) =>
        senders.map((sender) =>
          audience.canChat({ id: 'bot-1', accessMode }, sender),
        ),
      ),
    );

  it('every WhatsApp verdict is the same after the page lists an email and an organisation', async () => {
    const before = await verdicts();
    await pageAccess.add('page-1', [
      { kind: BotPageAccessKind.EMAIL, value: 'asha@example.com' },
      { kind: BotPageAccessKind.ORGANISATION, value: ORG },
    ]);
    expect(tables.chatbot_page_access).toHaveLength(2);
    expect(tables.chatbot_audience).toHaveLength(1);
    expect(await verdicts()).toEqual(before);
    // And the verdicts are the ones a listed-by-phone bot should give.
    expect(before.slice(8)).toEqual([true, false, false, false]);
    expect(BotPageAccess.INVITE).toBe('invite');
  });
});
