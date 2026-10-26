import {
  loadPromptTemplate,
  promptModelOr,
  shippedPromptDefault,
} from '../prompt-template.util';

const CODE = 'builder_exemplar_rank_system';

describe('loadPromptTemplate', () => {
  it("serves the store's live text when it has some", async () => {
    const prompts = { getPromptByCode: jest.fn().mockResolvedValue('Live.') };
    await expect(loadPromptTemplate(prompts, CODE)).resolves.toBe('Live.');
    expect(prompts.getPromptByCode).toHaveBeenCalledWith(CODE);
  });

  it('falls back to the shipped default when the store cannot be read', async () => {
    const prompts = {
      getPromptByCode: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const shipped = shippedPromptDefault(CODE);
    expect(shipped).toMatch(/^You pick which past builds/);
    await expect(loadPromptTemplate(prompts, CODE)).resolves.toBe(shipped);
  });

  it('falls back to the shipped default for blank or missing text, and with no store', async () => {
    const blank = { getPromptByCode: jest.fn().mockResolvedValue('  ') };
    await expect(loadPromptTemplate(blank, CODE)).resolves.toBe(
      shippedPromptDefault(CODE),
    );
    await expect(loadPromptTemplate(null, CODE)).resolves.toBe(
      shippedPromptDefault(CODE),
    );
  });

  it('throws rather than returning an empty prompt when there is no text anywhere', async () => {
    const prompts = { getPromptByCode: jest.fn().mockResolvedValue(null) };
    await expect(
      loadPromptTemplate(prompts, 'no_such_prompt_code'),
    ).rejects.toThrow(/no_such_prompt_code/);
  });
});

describe('promptModelOr', () => {
  const lookup = (config: any) => ({
    getPromptByCode: jest.fn(),
    getPromptLlmConfig: jest.fn().mockImplementation(async () => {
      if (config instanceof Error) throw config;
      return config;
    }),
  });

  it("uses the prompt's model and provider when the Skills Store names one", async () => {
    await expect(
      promptModelOr(
        lookup({ provider: 'openai', model: 'gpt-5-mini' }),
        CODE,
        'gemini-2.5-flash',
      ),
    ).resolves.toEqual({
      promptCode: CODE,
      model: 'gpt-5-mini',
      provider: 'openai',
    });
  });

  it('keeps the configured model when the prompt names none or cannot be read', async () => {
    for (const config of [{}, { provider: 'openai' }, new Error('db down')]) {
      await expect(
        promptModelOr(lookup(config), CODE, 'gemini-2.5-flash'),
      ).resolves.toEqual({ promptCode: CODE, model: 'gemini-2.5-flash' });
    }
    await expect(
      promptModelOr(null, CODE, 'gemini-2.5-flash'),
    ).resolves.toEqual({ promptCode: CODE, model: 'gemini-2.5-flash' });
  });
});
