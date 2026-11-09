import { AppConfigService } from 'src/config/config.service';
import { OpenAiImageProvider } from '../openai-image.provider';
import { GeminiImageProvider } from '../gemini-image.provider';

const mockGenerate = jest.fn();
const mockEdit = jest.fn();
const mockToFile = jest.fn(
  async (data: Buffer, name: string, options: { type: string }) => ({
    name,
    type: options.type,
    size: data.length,
  }),
);
jest.mock('openai', () => ({
  __esModule: true,
  toFile: (...args: unknown[]) => (mockToFile as any)(...args),
  default: jest.fn().mockImplementation(() => ({
    images: { generate: mockGenerate, edit: mockEdit },
  })),
}));

const mockGenerateContent = jest.fn();
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}));

const config = (imageModel: string) =>
  ({
    openai: { apiKey: 'sk-test', imageModel },
    gemini: { apiKey: 'g-test', imageModel: 'gemini-2.5-flash-image' },
  }) as unknown as AppConfigService;

const reference = { data: Buffer.from('ref'), mimeType: 'image/png' as const };

describe('image providers with reference images', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const b64 = Buffer.from('png').toString('base64');
    mockGenerate.mockResolvedValue({ data: [{ b64_json: b64 }] });
    mockEdit.mockResolvedValue({ data: [{ b64_json: b64 }] });
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ inlineData: { data: b64 } }] } }],
    });
  });

  it('OpenAI sends references through the edit endpoint, in order', async () => {
    const provider = new OpenAiImageProvider(config('gpt-image-1.5'));
    await provider.generateImage('Image 1 is Ravi', '1536x1024', {
      quality: 'medium',
      references: [
        reference,
        { data: Buffer.from('two'), mimeType: 'image/jpeg' },
      ],
    });
    expect(mockGenerate).not.toHaveBeenCalled();
    const params = mockEdit.mock.calls[0][0];
    expect(params).toMatchObject({
      model: 'gpt-image-1.5',
      prompt: 'Image 1 is Ravi',
      size: '1536x1024',
      quality: 'medium',
      n: 1,
    });
    expect(params.image.map((file: { name: string }) => file.name)).toEqual([
      'reference-1.png',
      'reference-2.jpg',
    ]);
    expect(params.input_fidelity).toBe('high');
  });

  it('OpenAI leaves input_fidelity off for later models, which reject it', async () => {
    const provider = new OpenAiImageProvider(config('gpt-image-2'));
    await provider.generateImage('x', '1024x1024', { references: [reference] });
    expect(mockEdit.mock.calls[0][0]).not.toHaveProperty('input_fidelity');
  });

  it('OpenAI without references still uses generate', async () => {
    const provider = new OpenAiImageProvider(config('gpt-image-1.5'));
    await provider.generateImage('x', '1024x1024');
    expect(mockEdit).not.toHaveBeenCalled();
    expect(mockGenerate).toHaveBeenCalled();
  });

  it('OpenAI reports how many references a model takes', () => {
    expect(
      new OpenAiImageProvider(config('gpt-image-1.5')).maxReferences(),
    ).toBe(16);
    expect(new OpenAiImageProvider(config('dall-e-3')).maxReferences()).toBe(0);
  });

  it('Gemini sends references as inline parts before the prompt', async () => {
    const provider = new GeminiImageProvider(config('gpt-image-1.5'));
    await provider.generateImage('Image 1 is Ravi', '1536x1024', {
      references: [reference],
    });
    const request = mockGenerateContent.mock.calls[0][0];
    const parts = request.contents[0].parts;
    expect(parts[0]).toEqual({
      inlineData: {
        mimeType: 'image/png',
        data: Buffer.from('ref').toString('base64'),
      },
    });
    expect(parts[1]).toEqual({ text: 'Image 1 is Ravi' });
  });

  it('Gemini without references sends the prompt as before', async () => {
    const provider = new GeminiImageProvider(config('gpt-image-1.5'));
    await provider.generateImage('plain', '1536x1024');
    expect(mockGenerateContent.mock.calls[0][0].contents).toBe('plain');
  });
});
