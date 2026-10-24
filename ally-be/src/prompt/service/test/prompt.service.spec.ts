import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PromptsService } from '../prompt.service';
import { PromptsRepository } from '../../repository/prompt.repository';
import { PromptVersionRepository } from '../../repository/prompt-version.repository';
import { PromptSharedService } from '../prompt-shared.service';
import { PromptTranslationService } from '../prompt-translation.service';
import { PromptVersioningService } from '../prompt-versioning.service';
import { CreatePromptsDto } from '../../dto/create-prompts.dto';
import { UpdatePromptDto } from '../../dto/update-prompt.dto';
import { Prompt } from '../../entity/prompt.entity';
import { PromptVersion } from '../../entity/prompt-version.entity';
import { PromptResponse } from '../../type/prompt-response.type';

// Mock ExecutionManager
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: jest.fn(),
    getExecutionId: jest.fn(),
  },
}));

import { ExecutionManager } from 'src/common/execution/execution-manager';
import { DataSource } from 'typeorm';

describe('PromptsService', () => {
  let service: PromptsService;
  let promptsRepository: PromptsRepository;
  let promptVersionRepository: PromptVersionRepository;
  let translatePrompt: jest.Mock;
  let versioning: Record<string, jest.Mock>;
  let promptSharedService: { getPromptByCode: jest.Mock };
  /** Raw-SQL escape hatch used by the scenario-usage queries. */
  let dataSourceQuery: jest.Mock;

  const mockUserId = '123';
  const mockPromptId = '123e4567-e89b-12d3-a456-426614174000';
  const mockVersionId = '223e4567-e89b-12d3-a456-426614174001';

  const mockPrompt: Prompt = {
    id: mockPromptId,
    promptCode: 'ally_ai_learn',
    name: 'AI Learning Prompt',
    description: 'A prompt for AI learning',
    currentVersion: 1,
    useDashboardOverride: true,
    isObsolete: false,
    createdAt: new Date('2026-02-09'),
    updatedAt: new Date('2026-02-09'),
  };

  const mockPromptVersion: PromptVersion = {
    id: mockVersionId,
    promptId: mockPromptId,
    version: 1,
    prompt: 'This is the prompt content',
    createdBy: 123,
    updatedBy: 123,
    createdAt: new Date('2026-02-09'),
    updatedAt: new Date('2026-02-09'),
  };

  const mockPromptResponse: PromptResponse = {
    id: mockPromptId,
    promptCode: 'ally_ai_learn',
    name: 'AI Learning Prompt',
    description: 'A prompt for AI learning',
    createdAt: new Date('2026-02-09'),
    prompt: 'This is the prompt content',
  };

  beforeEach(async () => {
    // Mock ExecutionManager.getUserId()
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue(mockUserId);

    const mockDataSource = {
      transaction: jest.fn().mockImplementation(async (cb: any) => await cb()),
      query: (dataSourceQuery = jest.fn().mockResolvedValue([{ count: '0' }])),
    } as unknown as DataSource;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptsService,
        {
          provide: PromptsRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            getPrompts: jest.fn(),
            getPromptById: jest.fn(),
          },
        },
        {
          provide: PromptVersionRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            delete: jest.fn(),
            getLatestPromptVersion: jest.fn(),
          },
        },
        {
          provide: PromptSharedService,
          useValue: {
            getPromptByCode: jest.fn(),
            getPromptsByOptions: jest.fn(),
          },
        },
        {
          provide: PromptTranslationService,
          useValue: {
            translatePrompt: (translatePrompt = jest
              .fn()
              .mockResolvedValue({ eligible: true, translated: 4 })),
          },
        },
        {
          provide: PromptVersioningService,
          useValue: (versioning = {
            createVersion: jest.fn().mockResolvedValue({
              version: 4,
              contentHash: 'h4',
            }),
            createAndPromote: jest
              .fn()
              .mockResolvedValue({ version: 1, failedLanguages: [] }),
            promote: jest.fn(),
            latestVersionOf: jest.fn().mockResolvedValue(3),
            listVersions: jest.fn(),
          }),
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    })
      .overrideProvider(DataSource)
      .useValue(mockDataSource)
      .compile();

    service = module.get<PromptsService>(PromptsService);
    promptsRepository = module.get<PromptsRepository>(PromptsRepository);
    promptVersionRepository = module.get<PromptVersionRepository>(
      PromptVersionRepository,
    );
    promptSharedService = module.get(PromptSharedService) as never;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createPrompts', () => {
    it('creates each prompt with its text live as version 1, through the write path', async () => {
      const dto: CreatePromptsDto = {
        prompts: [
          {
            promptCode: 'New Prompt',
            name: 'New',
            description: 'd',
            prompt: 'Hello {name}',
          } as any,
        ],
      };
      (promptsRepository.create as jest.Mock).mockImplementation((v) => v);
      (promptsRepository.save as jest.Mock).mockImplementation(async (v) =>
        v.map((p: any, i: number) => ({ ...p, id: `id-${i}` })),
      );

      const [saved] = await service.createPrompts(dto);

      expect(versioning.createAndPromote).toHaveBeenCalledWith(
        'id-0',
        expect.objectContaining({
          body: 'Hello {name}',
          baseVersion: null,
          createdBy: 123,
        }),
      );
      expect(saved.currentVersion).toBe(1);
    });
  });

  describe('updatePrompt — metadata only', () => {
    beforeEach(() => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue({
        ...mockPrompt,
        model: 'gpt-5',
      });
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });
      promptSharedService.getPromptByCode.mockResolvedValue('Live text.');
    });

    it('throws NotFoundException when the prompt does not exist', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue(null);
      await expect(
        service.updatePrompt(mockPromptId, { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates metadata without touching versions', async () => {
      await service.updatePrompt(mockPromptId, {
        name: 'Renamed',
        description: 'New description',
      });

      expect(promptsRepository.update).toHaveBeenCalledWith(
        mockPromptId,
        expect.objectContaining({
          name: 'Renamed',
          description: 'New description',
        }),
      );
      expect(versioning.createVersion).not.toHaveBeenCalled();
    });

    it.each([
      ['new text', { prompt: 'Different text.' }, 'prompt'],
      ['a model change', { model: 'gemini-2.5-pro' }, 'model'],
      ['a code change', { promptCode: 'renamed_code' }, 'promptCode'],
    ])('refuses %s: that changes through a version', async (_l, dto, field) => {
      await expect(
        service.updatePrompt(mockPromptId, dto as UpdatePromptDto),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: 'SKILLS_STORE_USE_VERSIONS',
          details: { fields: [field] },
        }),
      });
      expect(promptsRepository.update).not.toHaveBeenCalled();
    });

    it('accepts a form that resends the unchanged live text and model', async () => {
      await service.updatePrompt(mockPromptId, {
        description: 'Only this changed',
        prompt: '  Live text.  ',
        model: 'gpt-5',
      });

      expect(promptsRepository.update).toHaveBeenCalledWith(
        mockPromptId,
        expect.objectContaining({ description: 'Only this changed' }),
      );
    });
  });

  describe('createVersion', () => {
    it('saves the editor text as a candidate from the base the editor opened', async () => {
      const result = await service.createVersion(mockPromptId, {
        prompt: 'Better text.',
        baseVersion: 3,
        model: 'gpt-5',
      });

      expect(versioning.createVersion).toHaveBeenCalledWith(
        mockPromptId,
        expect.objectContaining({
          body: 'Better text.',
          baseVersion: 3,
          model: 'gpt-5',
          source: 'dashboard',
          createdBy: 123,
        }),
      );
      expect(result).toEqual({
        version: 4,
        contentHash: 'h4',
        status: 'candidate',
      });
    });
  });

  describe('updatePrompt — auto-translation trigger', () => {
    it('translates the live text when translation is just enabled', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue({
        ...mockPrompt,
        promptType: 'main_agent',
        translationEnabled: false,
      });
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.updatePrompt(mockPromptId, { translationEnabled: true });

      expect(translatePrompt).toHaveBeenCalledWith(mockPromptId);
    });

    it('does not translate for a non-translatable promptType', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue({
        ...mockPrompt,
        promptType: 'evaluator',
      });
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.updatePrompt(mockPromptId, { translationEnabled: true });

      expect(translatePrompt).not.toHaveBeenCalled();
    });
  });

  describe('revertPrompt', () => {
    it('puts the Git default live as a new version, from the newest version', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue({
        ...mockPrompt,
        defaultPrompt: 'Default text.',
        model: 'gpt-5',
      });

      await service.revertPrompt(mockPromptId);

      expect(versioning.createAndPromote).toHaveBeenCalledWith(
        mockPromptId,
        expect.objectContaining({
          body: 'Default text.',
          baseVersion: 3,
          model: 'gpt-5',
          source: 'revert',
        }),
      );
    });

    it('refuses when there is no default in Git', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue(mockPrompt);
      await expect(service.revertPrompt(mockPromptId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getPrompts', () => {
    it('should return array of prompts', async () => {
      const mockPrompts: PromptResponse[] = [mockPromptResponse];

      (promptsRepository.getPrompts as jest.Mock).mockResolvedValue(
        mockPrompts,
      );

      const result = await service.getPrompts();

      expect(result).toEqual(mockPrompts);
      expect(promptsRepository.getPrompts).toHaveBeenCalledWith(
        undefined,
        true,
        undefined,
      );
    });

    it('should pass search and pagination parameters to repository', async () => {
      const mockPrompts: PromptResponse[] = [mockPromptResponse];
      const searchName = 'AI';
      const pagination = { limit: 10, offset: 0 };

      (promptsRepository.getPrompts as jest.Mock).mockResolvedValue(
        mockPrompts,
      );

      const result = await service.getPrompts(searchName, pagination);

      expect(result).toEqual(mockPrompts);
      expect(promptsRepository.getPrompts).toHaveBeenCalledWith(
        searchName,
        true,
        pagination,
      );
    });

    it('should return empty array when no prompts exist', async () => {
      (promptsRepository.getPrompts as jest.Mock).mockResolvedValue([]);

      const result = await service.getPrompts();

      expect(result).toEqual([]);
    });

    it('should handle repository errors', async () => {
      const error = new Error('Database error');
      (promptsRepository.getPrompts as jest.Mock).mockRejectedValue(error);

      await expect(service.getPrompts()).rejects.toThrow('Database error');
    });
  });

  describe('visibleInStudio', () => {
    it('persists the flag when the DTO carries it', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue(mockPrompt);
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.updatePrompt(mockPromptId, { visibleInStudio: false });

      expect(promptsRepository.update).toHaveBeenCalledWith(
        mockPromptId,
        expect.objectContaining({ visibleInStudio: false }),
      );
    });

    it('leaves the flag alone when the DTO omits it', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue(mockPrompt);
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.updatePrompt(mockPromptId, { name: 'Renamed' });

      const [, updateData] = (promptsRepository.update as jest.Mock).mock
        .calls[0];
      expect(updateData).not.toHaveProperty('visibleInStudio');
    });

    it('creates a new variant visible, so it is selectable immediately', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue({
        ...mockPrompt,
        promptType: 'main_agent',
      });
      (promptVersionRepository.findOne as jest.Mock).mockResolvedValue(
        mockPromptVersion,
      );
      (promptsRepository.create as jest.Mock).mockImplementation(
        (data: unknown) => data,
      );
      (promptsRepository.save as jest.Mock).mockImplementation(
        async (data: object) => ({ ...data, id: 'new-id' }),
      );
      (promptVersionRepository.create as jest.Mock).mockImplementation(
        (data: unknown) => data,
      );
      (promptVersionRepository.save as jest.Mock).mockResolvedValue(
        mockPromptVersion,
      );
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.duplicatePrompt(mockPromptId);

      expect(promptsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibleInStudio: true }),
      );
    });
  });

  describe('getPromptUsage — metadata key by promptType', () => {
    it('counts main_agent references via selectedMainPromptCode', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue({
        ...mockPrompt,
        promptType: 'main_agent',
      });
      dataSourceQuery.mockResolvedValue([{ count: '0' }]);

      await service.getPromptUsage(mockPromptId);

      expect(dataSourceQuery).toHaveBeenCalledWith(expect.any(String), [
        mockPrompt.promptCode,
        'selectedMainPromptCode',
      ]);
    });

    it('counts transcript_evaluator references via selectedEvaluatorPromptCode', async () => {
      // Without the type-aware key an evaluator variant always reported zero
      // usage, so the studio would claim nothing depended on it.
      (promptsRepository.findOne as jest.Mock).mockResolvedValue({
        ...mockPrompt,
        promptType: 'transcript_evaluator',
      });
      dataSourceQuery.mockResolvedValue([{ count: '2' }]);

      const result = await service.getPromptUsage(mockPromptId);

      expect(dataSourceQuery).toHaveBeenCalledWith(expect.any(String), [
        mockPrompt.promptCode,
        'selectedEvaluatorPromptCode',
      ]);
      expect(result.count).toBe(2);
    });

    it('falls back to selectedMainPromptCode for an untyped prompt', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue(mockPrompt);
      dataSourceQuery.mockResolvedValue([{ count: '0' }]);

      await service.getPromptUsage(mockPromptId);

      expect(dataSourceQuery).toHaveBeenCalledWith(expect.any(String), [
        mockPrompt.promptCode,
        'selectedMainPromptCode',
      ]);
    });
  });
});

describe('PromptsService.syncPrompts — sidecar default model', () => {
  const build = async () => {
    const promptsRepository = {
      findOne: jest.fn(),
      create: jest.fn((values) => values),
      save: jest.fn(async (values) => ({ id: 'p1', ...values })),
      update: jest.fn(),
      // The obsolete-marking pass builds a query first; this code matches no
      // sync-source prefix, so it returns before running it.
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
      })),
    };
    const promptVersionRepository = {
      create: jest.fn((values) => values),
      save: jest.fn(async (values) => values),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptsService,
        { provide: PromptsRepository, useValue: promptsRepository },
        { provide: PromptVersionRepository, useValue: promptVersionRepository },
        {
          provide: PromptSharedService,
          useValue: {
            getPromptByCode: jest.fn(),
            getPromptsByOptions: jest.fn(),
          },
        },
        {
          provide: PromptTranslationService,
          useValue: { translatePrompt: jest.fn() },
        },
        { provide: PromptVersioningService, useValue: {} },
        {
          provide: DataSource,
          useValue: { transaction: jest.fn(), query: jest.fn() },
        },
      ],
    }).compile();
    return {
      service: module.get(PromptsService),
      promptsRepository,
      promptVersionRepository,
    };
  };

  const item = {
    promptCode: 'product_updates_consolidate',
    name: 'Product updates — consolidate merges',
    description: 'x',
    prompt: 'You keep the changelog.',
    availableVariables: [],
    defaultProvider: 'openai',
    defaultModel: 'gpt-5',
  };

  it('starts a new row on the default model', async () => {
    const { service, promptsRepository } = await build();
    promptsRepository.findOne.mockResolvedValue(null);

    await service.syncPrompts({ prompts: [item] } as any);

    expect(promptsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', model: 'gpt-5' }),
    );
  });

  it('never changes the model of a row that already exists', async () => {
    const { service, promptsRepository } = await build();
    promptsRepository.findOne.mockResolvedValue({
      id: 'p1',
      promptCode: item.promptCode,
      model: 'gemini-2.5-pro',
      useDashboardOverride: false,
    });

    await service.syncPrompts({ prompts: [item] } as any);

    const payload = promptsRepository.update.mock.calls[0]?.[1] ?? {};
    expect(payload).not.toHaveProperty('model');
    expect(payload).not.toHaveProperty('provider');
  });

  it("publishes a new prompt's default as live version 1, with its contract", async () => {
    const { service, promptsRepository, promptVersionRepository } =
      await build();
    promptsRepository.findOne.mockResolvedValue(null);

    await service.syncPrompts({
      prompts: [{ ...item, contract: { required: ['x'] } }],
    } as any);

    expect(promptsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ contract: { required: ['x'] } }),
    );
    expect(promptVersionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        source: 'sync',
        publishedAt: expect.any(Date),
      }),
    );
  });

  it("never touches an existing prompt's live text or its admin-chosen name", async () => {
    const { service, promptsRepository, promptVersionRepository } =
      await build();
    promptsRepository.findOne.mockResolvedValue({
      id: 'p1',
      promptCode: item.promptCode,
      name: 'Renamed in the Skills Store',
      availableVariables: [{ name: 'a' }],
    });

    await service.syncPrompts({ prompts: [item] } as any);

    expect(promptVersionRepository.save).not.toHaveBeenCalled();
    const payload = promptsRepository.update.mock.calls[0]?.[1] ?? {};
    expect(payload).toEqual(
      expect.objectContaining({ defaultPrompt: item.prompt }),
    );
    expect(payload).not.toHaveProperty('name');
    expect(payload).not.toHaveProperty('availableVariables');
  });

  it('skips a failing item and keeps syncing the rest', async () => {
    const { service, promptsRepository } = await build();
    promptsRepository.findOne
      .mockRejectedValueOnce(new Error('duplicate key value'))
      .mockResolvedValueOnce(null);

    const result = await service.syncPrompts({
      prompts: [item, { ...item, promptCode: 'product_updates_second' }],
    } as any);

    expect(result.added).toBe(1);
  });
});
