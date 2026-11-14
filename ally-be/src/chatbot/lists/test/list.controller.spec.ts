import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatbotMemberRole } from '../../enum/chatbot.enum';
import { CHATBOT_ROLE_RANK } from '../../enum/chatbot.enum';
import { ListController } from '../list.controller';

const BOT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';

/** Every handler, called with harmless arguments. */
const CALLS: [
  keyof ListController,
  ChatbotMemberRole,
  (c: ListController, bot: string) => Promise<unknown>,
][] = [
  ['listLists', ChatbotMemberRole.VIEWER, (c, b) => c.listLists(b)],
  ['getList', ChatbotMemberRole.VIEWER, (c, b) => c.getList(b, 'slots')],
  [
    'listRecords',
    ChatbotMemberRole.VIEWER,
    (c, b) => c.listRecords(b, 'slots', { 'eq.open': 'true' }),
  ],
  [
    'queryRecords',
    ChatbotMemberRole.VIEWER,
    (c, b) => c.queryRecords(b, 'slots', {}),
  ],
  [
    'getRecord',
    ChatbotMemberRole.VIEWER,
    (c, b) => c.getRecord(b, 'slots', ID),
  ],
  [
    'createList',
    ChatbotMemberRole.EDITOR,
    (c, b) => c.createList(b, { key: 'k', name: 'K' }),
  ],
  [
    'updateList',
    ChatbotMemberRole.EDITOR,
    (c, b) => c.updateList(b, 'slots', {}),
  ],
  ['deleteList', ChatbotMemberRole.EDITOR, (c, b) => c.deleteList(b, 'slots')],
  ['restoreList', ChatbotMemberRole.EDITOR, (c, b) => c.restoreList(b, ID)],
  [
    'addField',
    ChatbotMemberRole.EDITOR,
    (c, b) => c.addField(b, 'slots', {} as never),
  ],
  [
    'updateField',
    ChatbotMemberRole.EDITOR,
    (c, b) => c.updateField(b, 'slots', 'f', {}),
  ],
  [
    'archiveField',
    ChatbotMemberRole.EDITOR,
    (c, b) => c.archiveField(b, 'slots', 'f'),
  ],
  [
    'addRule',
    ChatbotMemberRole.EDITOR,
    (c, b) => c.addRule(b, 'slots', {} as never),
  ],
  [
    'removeRule',
    ChatbotMemberRole.EDITOR,
    (c, b) => c.removeRule(b, 'slots', ID),
  ],
  [
    'createRecord',
    ChatbotMemberRole.EDITOR,
    (c, b) => c.createRecord(b, 'slots', { data: {} }),
  ],
  [
    'updateRecord',
    ChatbotMemberRole.EDITOR,
    (c, b) => c.updateRecord(b, 'slots', ID, { data: {}, version: 1 }),
  ],
  [
    'deleteRecord',
    ChatbotMemberRole.EDITOR,
    (c, b) => c.deleteRecord(b, 'slots', ID),
  ],
  [
    'restoreRecord',
    ChatbotMemberRole.EDITOR,
    (c, b) => c.restoreRecord(b, 'slots', ID),
  ],
  [
    'exportCsv',
    ChatbotMemberRole.EDITOR,
    (c, b) =>
      c.exportCsv(b, 'slots', {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as never),
  ],
  [
    'importCsv',
    ChatbotMemberRole.EDITOR,
    (c, b) => c.importCsv(b, 'slots', { buffer: Buffer.from('') } as never, {}),
  ],
  // Chunk 5b.
  [
    'readyMadeCatalogue',
    ChatbotMemberRole.VIEWER,
    (c, b) => c.readyMadeCatalogue(b),
  ],
  [
    'searchContacts',
    ChatbotMemberRole.VIEWER,
    (c, b) => c.searchContacts(b, 'asha'),
  ],
  [
    'installReadyMade',
    ChatbotMemberRole.EDITOR,
    (c, b) => c.installReadyMade(b, 'appointments', {}),
  ],
  [
    'setAbilities',
    ChatbotMemberRole.EDITOR,
    (c, b) => c.setAbilities(b, 'appointments', { create: 'do_it' }),
  ],
  [
    'repeatRecords',
    ChatbotMemberRole.EDITOR,
    (c, b) =>
      c.repeatRecords(b, 'slots', {
        field: 'starts_at',
        days: [1],
        start: '10:00',
        end: '11:00',
        every_minutes: 60,
        until: '2026-12-01',
      }),
  ],
];

/** A member at `role` on BOT only: the real access service's answers. */
function build(role: ChatbotMemberRole) {
  const access = {
    assert: jest.fn(
      async (id: string, min: ChatbotMemberRole = ChatbotMemberRole.VIEWER) => {
        if (id !== BOT) throw new NotFoundException('Chatbot not found');
        if (CHATBOT_ROLE_RANK[role] < CHATBOT_ROLE_RANK[min]) {
          throw new ForbiddenException(
            'You can view this chatbot but not change it.',
          );
        }
        return { chatbot: {}, role };
      },
    ),
  };
  const any = () => new Proxy({}, { get: () => jest.fn(async () => ({})) });
  const controller = new ListController(
    access as never,
    any() as never,
    any() as never,
    any() as never,
    any() as never,
  );
  return { controller, access };
}

describe('ListController access (chunk 5a)', () => {
  it('covers every handler', () => {
    const handlers = Object.getOwnPropertyNames(
      ListController.prototype,
    ).filter((n) => n !== 'constructor');
    expect(CALLS.map(([name]) => name).sort()).toEqual(handlers.sort());
  });

  it.each(CALLS)('%s needs %s', async (_name, needs, call) => {
    const viewer = build(ChatbotMemberRole.VIEWER);
    if (needs === ChatbotMemberRole.VIEWER) {
      await expect(call(viewer.controller, BOT)).resolves.toBeDefined();
    } else {
      await expect(call(viewer.controller, BOT)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        call(build(ChatbotMemberRole.EDITOR).controller, BOT),
      ).resolves.not.toBeInstanceOf(Error);
    }
    await expect(
      call(build(ChatbotMemberRole.OWNER).controller, OTHER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
