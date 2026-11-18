import { ImageComposeService } from '../service/image-compose.service';
import {
  getSlotProfile,
  ImageSlotKind,
} from '../constants/image-slots.constants';
import { findImageStyle } from '../constants/image-styles.constants';

const slot = getSlotProfile(ImageSlotKind.SCENE);
const style = findImageStyle('cinematic_photo')!;

const build = (complete: jest.Mock) => {
  const llm = { complete } as any;
  const prompts = {
    getPromptByCode: jest
      .fn()
      .mockResolvedValue('{{image_purpose}} {{description}}'),
  } as any;
  return { service: new ImageComposeService(llm, prompts), llm, prompts };
};

const answer = (body: Record<string, unknown>) =>
  jest.fn().mockResolvedValue({ text: JSON.stringify(body) });

describe('ImageComposeService', () => {
  it('returns the model’s plan when it is safe', async () => {
    const { service, llm } = build(
      answer({
        safe: true,
        description: 'Ravi sits on his bed at night, phone glowing.',
        alt_text:
          'A young man sitting on his bed at night looking at his phone',
        scene: {
          people: [{ who: 'Ravi', action: 'sits', expression: 'tired' }],
          shot: 'medium',
        },
      }),
    );
    const result = await service.compose({
      slot,
      style,
      description: 'Ravi on his bed at night',
    });
    expect(result.safety.ok).toBe(true);
    expect(result.composed).toBe(true);
    expect(result.altText).toMatch(/young man/);
    expect(result.scene?.shot).toBe('medium');
    expect(llm.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'image-studio-compose',
        jsonMode: true,
        promptCode: 'image_studio_compose',
      }),
    );
  });

  it('passes on the model’s refusal with its suggestion', async () => {
    const { service } = build(
      answer({
        safe: false,
        reason: 'Shows a method.',
        suggestion: 'Show her sitting alone instead.',
        description: 'x',
      }),
    );
    const result = await service.compose({
      slot,
      style,
      description: 'She is about to hurt herself',
    });
    expect(result.safety).toEqual({
      ok: false,
      reason: 'Shows a method.',
      suggestion: 'Show her sitting alone instead.',
    });
  });

  it('blocks the author’s own description of a method without calling the model', async () => {
    const { service, llm } = build(answer({ safe: true }));
    const result = await service.compose({
      slot,
      style,
      description: 'a man with a noose',
    });
    expect(result.safety.ok).toBe(false);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('re-screens the model’s description, so a model that waves something through is caught', async () => {
    const { service } = build(
      answer({ safe: true, description: 'Blood on the floor beside her' }),
    );
    const result = await service.compose({
      slot,
      style,
      description: 'the aftermath',
    });
    expect(result.safety.ok).toBe(false);
  });

  it('falls back to the author’s description when the model is down', async () => {
    const { service } = build(
      jest.fn().mockRejectedValue(new Error('timeout')),
    );
    const result = await service.compose({
      slot,
      style,
      description: 'A counsellor listening',
    });
    expect(result).toMatchObject({
      composed: false,
      description: 'A counsellor listening',
      safety: { ok: true },
    });
  });

  it('drafts from course content when there is no description, and still screens it on fallback', async () => {
    const { service } = build(jest.fn().mockRejectedValue(new Error('down')));
    const ok = await service.compose({
      slot,
      style,
      context: { title: 'First call', text: '<p>A nervous caller</p>' },
    });
    expect(ok.description).toBe('First call. A nervous caller');
    const blocked = await service.compose({
      slot,
      style,
      context: { text: 'He took a handful of pills' },
    });
    expect(blocked.safety.ok).toBe(false);
  });
});
