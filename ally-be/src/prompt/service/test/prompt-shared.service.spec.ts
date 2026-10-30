import { Test } from '@nestjs/testing';
import { PromptSharedService } from '../prompt-shared.service';
import { PromptsRepository } from '../../repository/prompt.repository';
import { PromptSearchOptions } from '../../type/prompt-response.type';
import { Prompt } from '../../entity/prompt.entity';

describe('PromptSharedService', () => {
  let service: PromptSharedService;
  let repository: PromptsRepository;

  const mockVersionsQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawMany: jest.fn(),
  };

  const mockPromptsQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PromptSharedService,
        {
          provide: PromptsRepository,
          useValue: {
            createQueryBuilder: jest.fn(() => mockPromptsQueryBuilder),
            manager: {
              createQueryBuilder: jest.fn(() => mockVersionsQueryBuilder),
            },
          },
        },
      ],
    }).compile();

    service = module.get(PromptSharedService);
    repository = module.get(PromptsRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getPromptsByOptions', () => {
    it('should fetch prompts with their live versions', async () => {
      const options: PromptSearchOptions = {
        promptCode: ['test_prompt', 'no_live_version'],
      };
      const mockPrompts = [
        {
          id: 'prompt-id-1',
          promptCode: 'test_prompt',
          name: 'Test Prompt',
          description: 'A test prompt',
          isObsolete: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          useDashboardOverride: true,
          availableVariables: [],
          hasStates: false,
          provider: 'openai',
          model: 'gpt-4',
          temperature: 0.7,
          defaultPrompt: 'Default prompt text',
          currentVersion: 1,
        },
        {
          id: 'prompt-id-2',
          promptCode: 'no_live_version',
          name: 'Test Prompt 2',
          description: 'Another test prompt',
          isObsolete: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          useDashboardOverride: true,
          availableVariables: [],
          hasStates: false,
          provider: 'openai',
          model: 'gpt-4',
          temperature: 0.5,
          defaultPrompt: 'Default for no live',
          currentVersion: null,
        },
      ] as Prompt[];

      const mockVersions = [
        {
          promptId: 'prompt-id-1',
          prompt: 'Live prompt text',
        },
      ];

      mockPromptsQueryBuilder.getMany.mockResolvedValue(mockPrompts);
      mockVersionsQueryBuilder.getRawMany.mockResolvedValue(mockVersions);

      const result = await service.getPromptsByOptions(options);

      expect(repository.createQueryBuilder).toHaveBeenCalledWith('prompt');
      expect(mockPromptsQueryBuilder.andWhere).toHaveBeenCalledWith(
        'prompt.promptCode IN (:...promptCodes)',
        { promptCodes: options.promptCode },
      );
      expect(repository.manager.createQueryBuilder).toHaveBeenCalled();
      expect(result).toHaveLength(2);

      // Prompt with live version
      expect(result[0].promptCode).toBe('test_prompt');
      expect(result[0].prompt).toBe('Live prompt text');
      expect(result[0].version).toBe(1);
      expect(result[0].temperature).toBe(0.7);
      expect(result[0].contentHash).toBeDefined();

      // Prompt without live version (fallback to default)
      expect(result[1].promptCode).toBe('no_live_version');
      expect(result[1].prompt).toBe('Default for no live');
      expect(result[1].version).toBe(null);
      expect(result[1].temperature).toBe(0.5);
      expect(result[1].contentHash).toBeDefined();
    });
  });
});
