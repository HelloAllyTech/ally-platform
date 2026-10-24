import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { PromptTranslationRepository } from '../prompt-translation.repository';
import {
  PromptTranslation,
  PromptTranslationStatus,
} from '../../entity/prompt-translation.entity';

describe('PromptTranslationRepository', () => {
  let repository: PromptTranslationRepository;

  const mockPromptId = '123e4567-e89b-12d3-a456-426614174000';
  const mockLanguageId = 7;

  const mockTranslation: PromptTranslation = {
    id: '223e4567-e89b-12d3-a456-426614174001',
    promptId: mockPromptId,
    languageId: mockLanguageId,
    promptVersionId: '323e4567-e89b-12d3-a456-426614174002',
    translatedPrompt: 'अनुवादित टेम्पलेट {name}',
    sourceHash: 'abc123',
    status: PromptTranslationStatus.READY,
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    translationPromptVersion: '1',
    error: undefined,
    createdAt: new Date('2026-07-20'),
    updatedAt: new Date('2026-07-20'),
  };

  beforeEach(async () => {
    const mockDataSource = { createEntityManager: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptTranslationRepository,
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    repository = module.get<PromptTranslationRepository>(
      PromptTranslationRepository,
    );
  });

  afterEach(() => jest.clearAllMocks());

  describe('findForBody', () => {
    it('queries the row for one English body by (promptId, languageId, sourceHash)', async () => {
      const findOne = jest
        .spyOn(repository, 'findOne')
        .mockResolvedValue(mockTranslation);

      const result = await repository.findForBody(
        mockPromptId,
        mockLanguageId,
        'abc123',
      );

      expect(result).toEqual(mockTranslation);
      expect(findOne).toHaveBeenCalledWith({
        where: {
          promptId: mockPromptId,
          languageId: mockLanguageId,
          sourceHash: 'abc123',
        },
      });
    });

    it('returns null when that body has no translation', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      const result = await repository.findForBody(
        mockPromptId,
        mockLanguageId,
        'abc123',
      );

      expect(result).toBeNull();
    });
  });

  describe('findAllForBody', () => {
    it("lists every language's translation of one body ordered by languageId", async () => {
      const find = jest
        .spyOn(repository, 'find')
        .mockResolvedValue([mockTranslation]);

      const result = await repository.findAllForBody(mockPromptId, 'abc123');

      expect(result).toEqual([mockTranslation]);
      expect(find).toHaveBeenCalledWith({
        where: { promptId: mockPromptId, sourceHash: 'abc123' },
        order: { languageId: 'ASC' },
      });
    });
  });

  describe('upsertTranslation', () => {
    it('upserts on the (promptId, languageId, sourceHash) conflict key', async () => {
      const upsert = jest
        .spyOn(repository, 'upsert')
        .mockResolvedValue({} as any);

      await repository.upsertTranslation({
        promptId: mockPromptId,
        languageId: mockLanguageId,
        sourceHash: 'abc123',
        status: PromptTranslationStatus.READY,
        translatedPrompt: 'अनुवादित टेम्पलेट {name}',
      });

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          promptId: mockPromptId,
          languageId: mockLanguageId,
          sourceHash: 'abc123',
          status: PromptTranslationStatus.READY,
        }),
        expect.objectContaining({
          conflictPaths: ['promptId', 'languageId', 'sourceHash'],
        }),
      );
    });
  });

  describe('markStatus', () => {
    it('updates status and error for the row of one body', async () => {
      const update = jest
        .spyOn(repository, 'update')
        .mockResolvedValue({} as any);

      await repository.markStatus(
        mockPromptId,
        mockLanguageId,
        'abc123',
        PromptTranslationStatus.FAILED,
        'gemini timeout',
      );

      expect(update).toHaveBeenCalledWith(
        {
          promptId: mockPromptId,
          languageId: mockLanguageId,
          sourceHash: 'abc123',
        },
        { status: PromptTranslationStatus.FAILED, error: 'gemini timeout' },
      );
    });
  });
});
