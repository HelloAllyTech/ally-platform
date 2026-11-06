import { BadRequestException } from '@nestjs/common';
import { KbDocumentSourceType } from '../../../knowledge-base/enum/knowledge-base.enum';
import { ChatbotService } from '../chatbot.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

const BOT = 'bot-1';

/**
 * A chatbot's own documents (chunk 3d): uploaded on its Knowledge tab, always attached, removed
 * by archiving, and never mixed up with another bot's.
 */
describe("ChatbotService and a chatbot's own documents", () => {
  /** Documents in kb_documents: id → owner chatbot (null = shared library). */
  let documents: Map<string, string | null>;
  /** chatbot_documents rows for BOT. */
  let attached: Set<string>;
  let knowledgeBase: {
    createChatbotUploadUrl: jest.Mock;
    createForChatbot: jest.Mock;
    archiveForChatbot: jest.Mock;
  };
  let service: ChatbotService;

  /** The two queries ChatbotService runs against kb_documents, answered from `documents`. */
  const query = jest.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM chatbot_documents cd')) {
      return [...attached].map((id) => ({
        id,
        title: id,
        status: 'indexed',
        is_global: false,
        owner_chatbot_id: documents.get(id) ?? null,
        archived_at: null,
        updatedAt: new Date(0),
      }));
    }
    if (sql.includes('WHERE owner_chatbot_id = $1')) {
      return [...documents]
        .filter(([, owner]) => owner === params[0])
        .map(([id]) => ({ id }));
    }
    if (sql.includes('WHERE id = ANY($1::uuid[])')) {
      const [ids, bot] = params as [string[], string];
      return ids
        .filter(
          (id) => documents.has(id) && [null, bot].includes(documents.get(id)!),
        )
        .map((id) => ({ id }));
    }
    return [];
  });

  beforeEach(() => {
    documents = new Map<string, string | null>([
      ['shared-1', null],
      ['own-1', BOT],
      ['other-bots', 'bot-2'],
    ]);
    attached = new Set(['shared-1', 'own-1']);
    query.mockClear();
    knowledgeBase = {
      createChatbotUploadUrl: jest.fn(async () => ({
        presignedUrl: 'put',
        fileUrl: 'file',
      })),
      createForChatbot: jest.fn(async () => {
        documents.set('own-2', BOT);
        return { id: 'own-2' };
      }),
      archiveForChatbot: jest.fn(async (_bot: string, id: string) => {
        documents.delete(id);
      }),
    };
    const manager = {
      query,
      transaction: async (work: (m: unknown) => Promise<void>) =>
        work({
          delete: async () => attached.clear(),
          insert: async (_entity: unknown, rows: { documentId: string }[]) =>
            rows.forEach((r) => attached.add(r.documentId)),
        }),
    };
    const documentRepository = {
      manager,
      insert: jest.fn(async (row: { documentId: string }) =>
        attached.add(row.documentId),
      ),
      delete: jest.fn(async (where: { documentId: string }) =>
        attached.delete(where.documentId),
      ),
    };
    const chatbotRepository = { manager, update: jest.fn() };
    service = new ChatbotService(
      chatbotRepository as never,
      {} as never,
      documentRepository as never,
      {} as never,
      { update: jest.fn() } as never,
      { assert: jest.fn(async () => ({ chatbot: { id: BOT } })) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      knowledgeBase as never,
    );
  });

  it('marks the bot’s own documents as private in its list', async () => {
    const list = await service.listDocuments(BOT);
    expect(list.map((d) => [d.id, d.private])).toEqual([
      ['shared-1', false],
      ['own-1', true],
    ]);
  });

  it('keeps its own documents attached when the library selection is replaced', async () => {
    await service.setDocuments(BOT, []);
    expect([...attached].sort()).toEqual(['own-1']);
  });

  it("refuses another bot's own document", async () => {
    await expect(
      service.setDocuments(BOT, ['other-bots']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('adds an uploaded document as its own and attaches it', async () => {
    const dto = {
      title: 'Clinic FAQ',
      sourceType: KbDocumentSourceType.PDF,
      fileUrl: 'file',
    };
    const list = await service.addOwnDocument(BOT, dto as never);
    expect(knowledgeBase.createForChatbot).toHaveBeenCalledWith(BOT, dto);
    expect(list.find((d) => d.id === 'own-2')?.private).toBe(true);
  });

  it('archives its own document when it is removed', async () => {
    await service.removeDocument(BOT, 'own-1');
    expect(knowledgeBase.archiveForChatbot).toHaveBeenCalledWith(BOT, 'own-1');
    expect(attached.has('own-1')).toBe(false);
  });

  it('only takes a shared document off the bot, leaving it in the library', async () => {
    await service.removeDocument(BOT, 'shared-1');
    expect(knowledgeBase.archiveForChatbot).not.toHaveBeenCalled();
    expect(attached.has('shared-1')).toBe(false);
    expect(documents.has('shared-1')).toBe(true);
  });

  it('archives its own documents when the bot is archived', async () => {
    await service.archive(BOT);
    expect(knowledgeBase.archiveForChatbot).toHaveBeenCalledWith(BOT, 'own-1');
    expect(knowledgeBase.archiveForChatbot).toHaveBeenCalledTimes(1);
  });
});
