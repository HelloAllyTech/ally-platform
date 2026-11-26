import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { WaKeywordTemplate } from 'src/whatsapp/entity/wa-keyword-template.entity';
import {
  WaTemplateKind,
  WaTemplateMatchType,
} from 'src/whatsapp/enum/whatsapp.enum';
import { WhatsAppAdminService } from 'src/whatsapp/service/whatsapp-admin.service';
import { ChatbotReplyService } from 'src/chatbot/service/chatbot-reply.service';

jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: { getUserId: () => 7, getExecutionId: () => undefined },
}));

const BOT = '11111111-1111-1111-1111-111111111111';
const OTHER_BOT = '22222222-2222-2222-2222-222222222222';

const row = (over: Partial<WaKeywordTemplate>): WaKeywordTemplate =>
  ({
    id: 'id',
    kind: WaTemplateKind.FAQ,
    name: 'reply',
    matchType: WaTemplateMatchType.ANY_OF,
    patterns: ['x'],
    languageCode: null,
    priority: 300,
    responseText: 'text',
    bypassRag: true,
    terminal: false,
    active: true,
    mandatory: false,
    archivedAt: null,
    chatbotId: null,
    overridesTemplateId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...over,
  }) as WaKeywordTemplate;

const crisis = row({
  id: 'crisis',
  kind: WaTemplateKind.CRISIS,
  name: 'Immediate risk',
  priority: 10,
  mandatory: true,
  terminal: true,
  responseText: 'Call {helpline_numbers}',
});
const greeting = row({
  id: 'greeting',
  kind: WaTemplateKind.COMMAND,
  name: 'Greeting',
  priority: 210,
  responseText: 'Hello!',
});

/**
 * Which replies a bot's bot uses. Its versions replace the defaults for it alone, its
 * own replies sit after the safety bands, and nothing it saves can lose the crisis reply.
 */
describe('Per-bot keyword replies', () => {
  describe('resolution', () => {
    it("gives every other bot the default, untouched by one bot's version", () => {
      const ours = row({
        id: 'ours',
        chatbotId: BOT,
        overridesTemplateId: 'crisis',
        responseText: 'Call Northwind 2200',
      });
      const rows = [crisis, greeting, ours];

      const forOrg = ChatbotReplyService.resolve(rows, BOT);
      expect(forOrg.map((t) => t.responseText)).toEqual([
        'Call Northwind 2200',
        'Hello!',
      ]);
      // The version keeps the crisis reply's place and kind.
      expect(forOrg[0]).toMatchObject({
        kind: WaTemplateKind.CRISIS,
        priority: 10,
      });

      expect(
        ChatbotReplyService.resolve(rows, OTHER_BOT).map((t) => t.id),
      ).toEqual(['crisis', 'greeting']);
      expect(ChatbotReplyService.resolve(rows, null).map((t) => t.id)).toEqual([
        'crisis',
        'greeting',
      ]);
    });

    it('TF1 round 2: knows which copies are still worded as their global', () => {
      const rows = [
        crisis,
        row({
          id: 'copy-same',
          chatbotId: BOT,
          overridesTemplateId: 'crisis',
          responseText: '  Call   {helpline_numbers} ',
        }),
        row({
          id: 'copy-own',
          chatbotId: OTHER_BOT,
          overridesTemplateId: 'crisis',
          responseText: 'Please call our night line now.',
        }),
      ];
      expect([...ChatbotReplyService.unchangedCopies(rows, BOT)]).toEqual([
        'copy-same',
      ]);
      expect(ChatbotReplyService.unchangedCopies(rows, OTHER_BOT).size).toBe(0);
      expect(ChatbotReplyService.unchangedCopies(rows, null).size).toBe(0);
    });

    it('ignores a row that would switch a required reply off, however it was saved', () => {
      const off = row({
        id: 'off',
        chatbotId: BOT,
        overridesTemplateId: 'crisis',
        active: false,
      });
      const resolved = ChatbotReplyService.resolve([crisis, off], BOT);
      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toMatchObject({ id: 'crisis', active: true });
    });

    it('honours switching an optional reply off', () => {
      const off = row({
        id: 'off',
        chatbotId: BOT,
        overridesTemplateId: 'greeting',
        active: false,
      });
      const resolved = ChatbotReplyService.resolve(
        [crisis, greeting, off],
        BOT,
      );
      expect(
        resolved.find((t) => t.overridesTemplateId === 'greeting')?.active,
      ).toBe(false);
      expect(resolved.find((t) => t.id === 'greeting')).toBeUndefined();
    });
  });

  describe('admin rules', () => {
    let service: WhatsAppAdminService;
    let repo: {
      findOne: jest.Mock;
      save: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };

    beforeEach(() => {
      repo = {
        findOne: jest.fn(),
        save: jest.fn(async (r) => r),
        create: jest.fn((r) => r),
        update: jest.fn(),
      };
      // Only the template repository is exercised; the rest are inert stand-ins.
      const unused = {} as never;
      service = new WhatsAppAdminService(
        repo as never,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
        unused,
      );
    });

    it('refuses to switch a required reply off for a bot', async () => {
      repo.findOne.mockResolvedValueOnce(crisis);
      await expect(
        service.customiseTemplate('crisis', BOT, { active: false }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // Stage 5 (D6) reverses the old rule: a bot's copy of a required reply is locked.
    it('refuses rewording a required reply on a bot (its copy is locked)', async () => {
      repo.findOne.mockResolvedValueOnce(crisis).mockResolvedValueOnce(null);
      await expect(
        service.customiseTemplate('crisis', BOT, {
          responseText: 'Call Northwind 2200',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('refuses a wording edit on an existing locked copy, and allows regional numbers', async () => {
      const locked = row({
        id: 'copy',
        chatbotId: BOT,
        overridesTemplateId: 'crisis',
        locked: true,
      } as never);
      repo.findOne.mockResolvedValueOnce(crisis).mockResolvedValueOnce(locked);
      await expect(
        service.customiseTemplate('crisis', BOT, { patterns: ['help'] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();

      repo.findOne
        .mockResolvedValueOnce(crisis)
        .mockResolvedValueOnce(locked)
        .mockResolvedValueOnce({
          ...locked,
          extraNumbers: ['+91 22 1234 5678'],
        });
      const saved = await service.customiseTemplate('crisis', BOT, {
        extraNumbers: ['+91 22 1234 5678'],
      });
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'copy' },
        expect.objectContaining({ extraNumbers: ['+91 22 1234 5678'] }),
      );
      expect(saved).toMatchObject({ extraNumbers: ['+91 22 1234 5678'] });
    });

    it('makes a locked copy of a required reply when a bot first adds numbers to it', async () => {
      repo.findOne.mockResolvedValueOnce(crisis).mockResolvedValueOnce(null);
      const saved = await service.customiseTemplate('crisis', BOT, {
        extraNumbers: ['+44 116 123'],
      });
      expect(saved).toMatchObject({
        chatbotId: BOT,
        overridesTemplateId: 'crisis',
        kind: WaTemplateKind.CRISIS,
        priority: 10,
        locked: true,
        extraNumbers: ['+44 116 123'],
      });
    });

    it("refuses a bot's own crisis or consent reply", async () => {
      await expect(
        service.createTemplate(
          {
            kind: WaTemplateKind.CRISIS,
            name: 'mine',
            matchType: WaTemplateMatchType.ANY_OF,
            patterns: ['help'],
            responseText: 'x',
            priority: 1,
          } as never,
          BOT,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("keeps a bot's own reply behind the safety bands", async () => {
      const saved = await service.createTemplate(
        {
          kind: WaTemplateKind.FAQ,
          name: 'Payday',
          matchType: WaTemplateMatchType.ANY_OF,
          patterns: ['payday'],
          responseText: 'Last working day',
          priority: 1,
        } as never,
        BOT,
      );
      expect(saved).toMatchObject({ chatbotId: BOT, priority: 300 });
    });
  });
});
