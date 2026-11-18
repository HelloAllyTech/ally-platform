import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExecutionManager } from '../../../common/execution/execution-manager';
import { KbCorpus, KbDocumentSourceType } from '../../enum/knowledge-base.enum';
import { KnowledgeBaseService } from '../knowledge-base.service';

const BUCKET = 'assets-bucket';
const BOT = '11111111-1111-1111-1111-111111111111';
const OTHER_BOT = '22222222-2222-2222-2222-222222222222';
const fileIn = (folder: string) =>
  `https://${BUCKET}.s3.ap-south-1.amazonaws.com/${folder}/1-faq.pdf`;

/** A chatbot's own documents (chunk 3d): uploaded on its Knowledge tab, tied to it. */
describe("KnowledgeBaseService — a chatbot's own documents", () => {
  let service: KnowledgeBaseService;
  let documentRepository: Record<string, jest.Mock>;
  let aiService: Record<string, jest.Mock>;
  let ingestProducer: { enqueue: jest.Mock };

  beforeEach(() => {
    jest.spyOn(ExecutionManager, 'getUserId').mockReturnValue(42 as any);
    documentRepository = {
      findOne: jest.fn(),
      create: jest.fn((v: any) => ({ ...v, id: 'new-doc' })),
      save: jest.fn(async (v: any) => v),
      update: jest.fn(),
    };
    aiService = { deleteKnowledgeChunksByDocument: jest.fn() };
    ingestProducer = { enqueue: jest.fn() };
    const s3Service = {
      parseS3Url: (url: string) => {
        const match =
          /^https:\/\/([^.]+)\.s3\.[^.]+\.amazonaws\.com\/(.+)$/.exec(url);
        return match ? { bucket: match[1], key: match[2] } : null;
      },
    };
    service = new KnowledgeBaseService(
      documentRepository as any,
      {} as any,
      {
        replaceForDocument: jest.fn(),
        tenantIdsForDocument: jest.fn().mockResolvedValue([]),
      } as any,
      ingestProducer as any,
      aiService as any,
      s3Service as any,
      { s3: { assetsBucket: BUCKET } } as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service, 'get').mockResolvedValue({ id: 'doc' } as any);
  });

  describe('createForChatbot', () => {
    it('creates it in the WhatsApp corpus, owned by the bot, targeted at nobody, and queues it', async () => {
      await service.createForChatbot(BOT, {
        title: ' Clinic FAQ ',
        sourceType: KbDocumentSourceType.PDF,
        fileUrl: fileIn(`knowledge-base/chatbots/${BOT}`),
        fileName: 'faq.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1000,
      } as any);

      expect(documentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          corpus: KbCorpus.WHATSAPP_QA,
          title: 'Clinic FAQ',
          isGlobal: false,
          ownerChatbotId: BOT,
        }),
      );
      expect(ingestProducer.enqueue).toHaveBeenCalledWith({
        documentId: 'new-doc',
        action: 'ingest',
      });
    });

    it("refuses a file that wasn't uploaded for this bot", async () => {
      await expect(
        service.createForChatbot(BOT, {
          title: 'FAQ',
          sourceType: KbDocumentSourceType.PDF,
          fileUrl: fileIn(`knowledge-base/chatbots/${OTHER_BOT}`),
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(documentRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('archiveForChatbot', () => {
    it("archives the bot's own document", async () => {
      documentRepository.findOne.mockResolvedValue({
        id: 'doc',
        corpus: KbCorpus.WHATSAPP_QA,
        ownerChatbotId: BOT,
        archivedAt: null,
      });
      await service.archiveForChatbot(BOT, 'doc');
      expect(aiService.deleteKnowledgeChunksByDocument).toHaveBeenCalledWith(
        'doc',
        KbCorpus.WHATSAPP_QA,
      );
      expect(documentRepository.update).toHaveBeenCalledWith(
        { id: 'doc' },
        expect.objectContaining({ archivedAt: expect.any(Date) }),
      );
    });

    it.each([
      ["another bot's", OTHER_BOT],
      ['a shared library', null],
    ])('treats %s document as not found', async (_label, owner) => {
      documentRepository.findOne.mockResolvedValue({
        id: 'doc',
        ownerChatbotId: owner,
      });
      await expect(
        service.archiveForChatbot(BOT, 'doc'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(documentRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('updateForChatbot', () => {
    const own = (over: Record<string, unknown> = {}) => ({
      id: 'doc',
      ownerChatbotId: BOT,
      archivedAt: null,
      contentHash: 'old-hash',
      rawText: 'old text',
      ...over,
    });

    it('renames it without retraining', async () => {
      documentRepository.findOne.mockResolvedValue(own());
      await service.updateForChatbot(BOT, 'doc', { title: ' New title ' });
      expect(documentRepository.update).toHaveBeenCalledWith(
        { id: 'doc' },
        expect.objectContaining({ title: 'New title' }),
      );
      expect(ingestProducer.enqueue).not.toHaveBeenCalled();
    });

    it('stores new text and trains the bot on it again', async () => {
      documentRepository.findOne.mockResolvedValue(own());
      await service.updateForChatbot(BOT, 'doc', { text: ' New text ' });
      expect(documentRepository.update).toHaveBeenCalledWith(
        { id: 'doc' },
        expect.objectContaining({ rawText: 'New text', status: 'pending' }),
      );
      expect(ingestProducer.enqueue).toHaveBeenCalledWith({
        documentId: 'doc',
        action: 'reindex',
      });
    });

    it('does nothing to the index when the text is unchanged', async () => {
      const { KbIngestService } = await import('../kb-ingest.service');
      documentRepository.findOne.mockResolvedValue(
        own({ contentHash: KbIngestService.hash('same text') }),
      );
      await service.updateForChatbot(BOT, 'doc', { text: 'same text' });
      expect(ingestProducer.enqueue).not.toHaveBeenCalled();
    });

    it("treats another bot's or a library document as not found", async () => {
      documentRepository.findOne.mockResolvedValue(
        own({ ownerChatbotId: null }),
      );
      await expect(
        service.updateForChatbot(BOT, 'doc', { title: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(documentRepository.update).not.toHaveBeenCalled();
    });
  });
});
