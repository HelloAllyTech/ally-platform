import { PromptSharedService } from '../prompt-shared.service';
import * as fs from 'fs';
import * as path from 'path';
import { hashPromptBody } from '../../util/prompt-contract.util';

// Mock the fs module
jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
  return {
    ...originalFs,
    promises: {
      ...originalFs.promises,
      stat: jest.fn(),
      readFile: jest.fn(),
      readdir: jest.fn(),
    },
  };
});
const mockedFs = fs.promises as jest.Mocked<typeof fs.promises>;

describe('PromptSharedService.getPromptsForRuntime with fallback', () => {
  const build = () => {
    const service = new PromptSharedService({} as any);
    const read = jest.spyOn(service, 'getPromptsByOptions');
    // Suppress console.error and console.warn for cleaner test output
    jest.spyOn(service['logger'], 'error').mockImplementation(() => {});
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => {});
    return { service, read };
  };

  it('should fall back to filesystem when store is unreadable and cache is empty', async () => {
    const { service, read } = build();
    read.mockRejectedValue(new Error('down'));

    const promptCode = 'fallback_test_prompt';
    const promptContent = 'This is a fallback from disk.';

    // Mock filesystem to return a prompt
    const promptsDir = path.join(process.cwd(), 'src/prompts');
    const flatPath = path.join(promptsDir, `${promptCode}.txt`);

    mockedFs.stat.mockImplementation(async (p) => {
      // a successful stat on promptsDir, then on the file
      if (p === promptsDir) return {} as any;
      if (p === flatPath) return {} as any;
      throw new Error('not found');
    });
    mockedFs.readFile.mockResolvedValue(promptContent);

    const result = await service.getPromptsForRuntime({
      promptCode: [promptCode],
    });

    expect(result).toEqual([
      {
        promptCode,
        prompt: promptContent,
        version: null,
        contentHash: hashPromptBody(promptContent),
        provider: undefined,
        model: undefined,
        temperature: undefined,
        useDashboardOverride: undefined,
        availableVariables: undefined,
        hasStates: undefined,
        defaultPrompt: undefined,
        currentVersion: undefined,
      },
    ]);
  });
});
