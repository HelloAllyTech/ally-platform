import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Chatbot } from '../../chatbot/entity/chatbot.entity';
import { BotPageAccessKind } from '../../chatbot/enum/bot-page.enum';
import {
  ChatbotAudienceKind,
  ChatbotMemberRole,
} from '../../chatbot/enum/chatbot.enum';
import { STALE_MESSAGE } from '../home/assistant-home.service';
import { listVersion, quickReplyOf } from '../home/home-lists';
import { HomeListsService } from '../home/home-lists.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: () => 7,
    getTenantId: () => 'tenant-1',
    getExecutionId: () => undefined,
  },
}));

const BOT = 'bot-1';
const OTHER = 'bot-2';

/** The lists' own services, in memory, keyed by bot; the access check refuses by role. */
function fixture(options: { role?: ChatbotMemberRole; admin?: boolean } = {}) {
  const role = options.role ?? ChatbotMemberRole.OWNER;
  const rank = [
    ChatbotMemberRole.VIEWER,
    ChatbotMemberRole.EDITOR,
    ChatbotMemberRole.OWNER,
  ];
  const access = {
    assert: jest.fn(async (_id: string, need = ChatbotMemberRole.VIEWER) => {
      if (rank.indexOf(role) < rank.indexOf(need)) {
        throw new ForbiddenException();
      }
    }),
    isPlatformAdmin: jest.fn(async () => Boolean(options.admin)),
  };
  let n = 0;
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const pageEntries = new Map<string, Record<string, unknown>[]>([
    ['page-1', []],
  ]);
  const audienceEntries = new Map<string, Record<string, unknown>[]>([
    [BOT, []],
    [OTHER, [{ id: id(), kind: 'email', value: 'x@other.test', label: null }]],
  ]);
  const members = new Map<string, { userId: number; role: string }[]>([
    [BOT, [{ userId: 7, role: ChatbotMemberRole.OWNER }]],
  ]);
  const documents = new Map<string, Record<string, unknown>[]>([
    [
      BOT,
      [
        {
          id: 'doc-own',
          title: 'Owner notes',
          status: 'indexed',
          private: true,
          isGlobal: false,
          archived: false,
        },
      ],
    ],
  ]);
  const templates: Record<string, unknown>[] = [
    {
      id: 'tpl-crisis',
      kind: 'crisis',
      name: 'Crisis',
      patterns: ['suicide'],
      responseText: 'Please call 14416.',
      active: true,
      mandatory: true,
      state: 'default',
    },
  ];

  const pages = {
    findForChatbot: jest.fn(async (bot: string) =>
      bot === BOT ? { id: 'page-1' } : null,
    ),
  };
  const pageAccess = {
    list: jest.fn(async (page: string) => pageEntries.get(page) ?? []),
    add: jest.fn(async (page: string, entries: Record<string, unknown>[]) => {
      for (const e of entries) {
        pageEntries.get(page)!.push({ id: id(), ...e, label: e.label ?? null });
      }
      return { added: entries.length, skipped: 0 };
    }),
    remove: jest.fn(async (page: string, entry: string) => {
      pageEntries.set(
        page,
        pageEntries.get(page)!.filter((e) => e.id !== entry),
      );
    }),
  };
  const audience = {
    list: jest.fn(async (bot: string) => audienceEntries.get(bot) ?? []),
    add: jest.fn(async (bot: string, entries: Record<string, unknown>[]) => {
      for (const e of entries) {
        audienceEntries.get(bot)!.push({ id: id(), ...e, label: null });
      }
      return { added: entries.length, skipped: 0 };
    }),
    remove: jest.fn(async (bot: string, entry: string) => {
      audienceEntries.set(
        bot,
        audienceEntries.get(bot)!.filter((e) => e.id !== entry),
      );
    }),
  };
  const chatbots = {
    listMembers: jest.fn(async (bot: string) =>
      (members.get(bot) ?? []).map((m) => ({
        ...m,
        name: `User ${m.userId}`,
        email: `u${m.userId}@clinic.test`,
      })),
    ),
    setMembers: jest.fn(
      async (
        bot: string,
        dto: { members: { userId: number; role: string }[] },
      ) => {
        if (!dto.members.some((m) => m.role === ChatbotMemberRole.OWNER)) {
          throw new BadRequestException('A chatbot needs at least one owner.');
        }
        members.set(bot, dto.members);
      },
    ),
    listDocuments: jest.fn(async (bot: string) => documents.get(bot) ?? []),
    setDocuments: jest.fn(async (bot: string, ids: string[]) => {
      const own = documents.get(bot)!.filter((d) => d.private);
      documents.set(bot, [
        ...own,
        ...ids.map((docId) => ({
          id: docId,
          title: docId,
          status: 'indexed',
          private: false,
          isGlobal: true,
          archived: false,
        })),
      ]);
    }),
    removeDocument: jest.fn(async (bot: string, docId: string) => {
      documents.set(
        bot,
        documents.get(bot)!.filter((d) => d.id !== docId),
      );
    }),
  };
  const replies = {
    listTemplates: jest.fn(async () => ({
      templates,
      count: templates.length,
    })),
    createTemplate: jest.fn(async (dto: Record<string, unknown>) => {
      templates.push({
        id: id(),
        ...dto,
        active: true,
        mandatory: false,
        state: 'own',
      });
    }),
    updateTemplate: jest.fn(),
    customiseTemplate: jest.fn(
      async (globalId: string, _bot: string, dto: Record<string, unknown>) => {
        const t = templates.find((x) => x.id === globalId)!;
        if (t.mandatory && dto.active === false) throw new ForbiddenException();
        Object.assign(t, dto, { state: 'customised' });
      },
    ),
    archiveTemplate: jest.fn(),
    reorderTemplates: jest.fn(),
  };
  const users = [
    { id: 8, email: 'meera@clinic.test', tenant: 'tenant-1' },
    { id: 9, email: 'ravi@elsewhere.test', tenant: 'tenant-2' },
  ];
  const lockedChatbot = { id: BOT } as Chatbot;
  const dataSource = {
    transaction: <T>(run: (manager: unknown) => Promise<T>) =>
      run({
        getRepository: () => ({ findOne: async () => lockedChatbot }),
      }),
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('JOIN tenants')) {
        return params[0] === 7
          ? [{ id: 'tenant-1', name: 'Sunrise Mind' }]
          : [];
      }
      const email = params[0];
      const found = users.filter(
        (u) =>
          u.email === email &&
          (!sql.includes('me.tenant_id') || u.tenant === 'tenant-1'),
      );
      return found.map((u) => ({ id: u.id }));
    }),
  };
  const service = new HomeListsService(
    dataSource as never,
    access as never,
    pages as never,
    pageAccess as never,
    audience as never,
    chatbots as never,
    replies as never,
  );
  return { service, pageAccess, audience, chatbots, replies, access };
}

describe('Home lists (chunk 20d-2)', () => {
  it('reads a list with the version of its entries', async () => {
    const { service } = fixture();
    const read = await service.read(BOT, 'team');
    expect(read.items).toEqual([
      {
        id: '7',
        userId: 7,
        name: 'User 7',
        email: 'u7@clinic.test',
        role: ChatbotMemberRole.OWNER,
      },
    ]);
    expect(read.version).toBe(listVersion(read.items));
  });

  it("offers the caller's own organisation by name on the lists that take one", async () => {
    const { service } = fixture();
    expect((await service.read(BOT, 'pageAccess')).yourOrganisation).toEqual({
      id: 'tenant-1',
      name: 'Sunrise Mind',
    });
    expect((await service.read(BOT, 'team')).yourOrganisation).toBeUndefined();
  });

  it('adds and removes an invited email, each with the version it started from', async () => {
    const { service, pageAccess } = fixture();
    const empty = await service.read(BOT, 'pageAccess');
    const added = await service.change(BOT, 'pageAccess', {
      op: 'add',
      item: { kind: BotPageAccessKind.EMAIL, value: 'asha@clinic.test' },
      version: empty.version,
    });
    expect(added.items).toHaveLength(1);
    expect(pageAccess.add).toHaveBeenCalledWith('page-1', [
      { kind: 'email', value: 'asha@clinic.test', label: undefined },
    ]);
    const removed = await service.change(BOT, 'pageAccess', {
      op: 'remove',
      id: added.items[0].id,
      version: added.version,
    });
    expect(removed.items).toEqual([]);
  });

  it('refuses a change based on a list that changed since, with the current list', async () => {
    const { service } = fixture();
    const first = await service.read(BOT, 'audience');
    await service.change(BOT, 'audience', {
      op: 'add',
      item: { kind: ChatbotAudienceKind.PHONE, value: '+919820012345' },
      version: first.version,
    });
    const stale = service.change(BOT, 'audience', {
      op: 'add',
      item: { kind: ChatbotAudienceKind.EMAIL, value: 'a@b.test' },
      version: first.version,
    });
    await expect(stale).rejects.toBeInstanceOf(ConflictException);
    await stale.catch((error: ConflictException) => {
      const body = error.getResponse() as {
        message: string;
        details: { items: unknown[]; version: string };
      };
      expect(body.message).toBe(STALE_MESSAGE);
      expect(body.details.items).toHaveLength(1);
    });
  });

  it("keeps each assistant's list to itself", async () => {
    const { service } = fixture();
    expect((await service.read(BOT, 'audience')).items).toEqual([]);
    expect((await service.read(OTHER, 'audience')).items).toHaveLength(1);
    const mine = await service.read(BOT, 'audience');
    const otherId = (await service.read(OTHER, 'audience')).items[0].id;
    await expect(
      service.change(BOT, 'audience', {
        op: 'remove',
        id: otherId,
        version: mine.version,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets a viewer read but not change, and only an owner change the team', async () => {
    const viewer = fixture({ role: ChatbotMemberRole.VIEWER });
    const read = await viewer.service.read(BOT, 'documents');
    await expect(
      viewer.service.change(BOT, 'documents', {
        op: 'remove',
        id: 'doc-own',
        version: read.version,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const editor = fixture({ role: ChatbotMemberRole.EDITOR });
    const team = await editor.service.read(BOT, 'team');
    await expect(
      editor.service.change(BOT, 'team', {
        op: 'add',
        item: { email: 'meera@clinic.test', role: ChatbotMemberRole.EDITOR },
        version: team.version,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('adds a team member by email from the same organisation, with the same roles as before', async () => {
    const { service, chatbots } = fixture();
    const team = await service.read(BOT, 'team');
    const added = await service.change(BOT, 'team', {
      op: 'add',
      item: { email: 'Meera@Clinic.test', role: ChatbotMemberRole.EDITOR },
      version: team.version,
    });
    expect(chatbots.setMembers).toHaveBeenCalledWith(BOT, {
      members: [
        { userId: 7, role: ChatbotMemberRole.OWNER },
        { userId: 8, role: ChatbotMemberRole.EDITOR },
      ],
    });
    await expect(
      service.change(BOT, 'team', {
        op: 'add',
        item: { email: 'ravi@elsewhere.test', role: ChatbotMemberRole.EDITOR },
        version: added.version,
      }),
    ).rejects.toThrow(
      "We couldn't find anyone in your organisation with that email.",
    );
    await expect(
      service.change(BOT, 'team', {
        op: 'add',
        item: { email: 'meera@clinic.test', role: 'boss' },
        version: added.version,
      }),
    ).rejects.toThrow('Choose what they can do.');
  });

  it("keeps the team's rule that an assistant needs an owner", async () => {
    const { service } = fixture();
    const team = await service.read(BOT, 'team');
    await expect(
      service.change(BOT, 'team', {
        op: 'remove',
        id: '7',
        version: team.version,
      }),
    ).rejects.toThrow('A chatbot needs at least one owner.');
  });

  it('adds a library document next to the assistant’s own ones', async () => {
    const { service, chatbots } = fixture();
    const docs = await service.read(BOT, 'documents');
    await service.change(BOT, 'documents', {
      op: 'add',
      item: { documentId: 'lib-1' },
      version: docs.version,
    });
    expect(chatbots.setDocuments).toHaveBeenCalledWith(BOT, ['lib-1']);
  });

  it("adds the owner's own quick reply, and only rewords Ally's crisis reply", async () => {
    const { service, replies } = fixture();
    const list = await service.read(BOT, 'quickReplies');
    expect(list.items[0]).toMatchObject({
      id: 'tpl-crisis',
      kind: 'crisis',
      required: true,
      state: 'default',
    });
    const added = await service.change(BOT, 'quickReplies', {
      op: 'add',
      item: {
        name: 'Parking',
        patterns: 'parking, park',
        responseText: 'There is parking at the back.',
      },
      version: list.version,
    });
    expect(replies.createTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'faq', patterns: ['parking', 'park'] }),
      BOT,
    );
    await expect(
      service.change(BOT, 'quickReplies', {
        op: 'remove',
        id: 'tpl-crisis',
        version: added.version,
      }),
    ).rejects.toThrow("Ally's replies can't be removed.");
    await expect(
      service.change(BOT, 'quickReplies', {
        op: 'edit',
        id: 'tpl-crisis',
        item: { active: false },
        version: added.version,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const reworded = await service.change(BOT, 'quickReplies', {
      op: 'edit',
      id: 'tpl-crisis',
      item: { responseText: 'Please call 14416 now.' },
      version: added.version,
    });
    expect(replies.customiseTemplate).toHaveBeenLastCalledWith(
      'tpl-crisis',
      BOT,
      { responseText: 'Please call 14416 now.' },
    );
    expect(reworded.items[0].responseText).toBe('Please call 14416 now.');
  });

  it('shows a reworded default with its original wording', () => {
    expect(
      quickReplyOf({
        id: 'mine',
        kind: 'faq',
        name: 'Hours',
        patterns: ['hours'],
        responseText: 'Open 9 to 7.',
        active: true,
        mandatory: false,
        state: 'customised',
        overridesTemplateId: 'global-1',
        defaultResponseText: 'Open 9 to 6.',
      }),
    ).toMatchObject({
      defaultId: 'global-1',
      defaultResponseText: 'Open 9 to 6.',
    });
  });
});
