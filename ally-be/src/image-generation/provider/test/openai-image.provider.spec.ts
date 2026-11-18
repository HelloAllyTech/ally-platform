import { OpenAiImageProvider } from '../openai-image.provider';
import { AppConfigService } from 'src/config/config.service';
import { ConfigService } from '@nestjs/config';

const mockGenerate = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    images: { generate: mockGenerate },
  })),
}));

const providerFor = (imageModel: string) =>
  new OpenAiImageProvider({
    openai: { apiKey: 'sk-test', imageModel },
  } as unknown as AppConfigService);

describe('OpenAiImageProvider', () => {
  beforeEach(() => {
    mockGenerate.mockReset();
    mockGenerate.mockResolvedValue({
      data: [{ b64_json: Buffer.from('png').toString('base64') }],
    });
  });

  it('leaves quality to the model default when none is asked for', async () => {
    await providerFor('gpt-image-1.5').generateImage('a bench', '1536x1024');
    expect(mockGenerate.mock.calls[0][0]).not.toHaveProperty('quality');
  });

  it('never sends a gpt-image tier or moderation to a dall-e model, which would reject them', async () => {
    await providerFor('dall-e-3').generateImage('a bench', '1792x1024', {
      quality: 'medium',
    });
    expect(mockGenerate.mock.calls[0][0]).not.toHaveProperty('quality');
    expect(mockGenerate.mock.calls[0][0]).not.toHaveProperty('moderation');
  });

  it('relaxes moderation for gpt-image models, so counselling topics are not refused', async () => {
    await providerFor('gpt-image-1.5').generateImage('a bench', '1536x1024', {
      quality: 'medium',
    });
    expect(mockGenerate.mock.calls[0][0]).toMatchObject({
      quality: 'medium',
      moderation: 'low',
    });
  });

  it('returns the decoded image bytes', async () => {
    const image = await providerFor('gpt-image-1.5').generateImage(
      'a bench',
      '1536x1024',
    );
    expect(image.toString()).toBe('png');
  });

  it('uses gpt-image-1.5 as the default model for image generation', async () => {
    const configService = new ConfigService();
    jest
      .spyOn(configService, 'get')
      .mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'OPENAI_API_KEY') {
          return 'sk-test';
        }
        // This simulates the ConfigService behavior for unset values with defaults.
        return defaultValue;
      });

    const appConfigService = new AppConfigService(configService);
    const provider = new OpenAiImageProvider(appConfigService);

    await provider.generateImage('a bench', '1024x1024');

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-image-1.5' }),
    );
  });
});
