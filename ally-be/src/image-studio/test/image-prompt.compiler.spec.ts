import { IMAGE_GUARDRAILS } from '../constants/image-safety.constants';
import {
  getSlotProfile,
  ImageSlotKind,
} from '../constants/image-slots.constants';
import { findImageStyle } from '../constants/image-styles.constants';
import {
  compileImagePrompt,
  describeScene,
} from '../util/image-prompt.compiler';

const scene = getSlotProfile(ImageSlotKind.SCENE);
const style = findImageStyle('graphic_novel')!;

describe('compileImagePrompt', () => {
  it('ends with every guardrail, whatever else is in the prompt', () => {
    const prompt = compileImagePrompt({
      slot: scene,
      style,
      description: 'Ravi sits on the bed, phone in hand.',
    });
    const rules = prompt.split('\n\n').pop()!;
    for (const rule of IMAGE_GUARDRAILS) {
      expect(rules).toContain(rule);
    }
  });

  it('carries the style fragment and the slot framing', () => {
    const prompt = compileImagePrompt({
      slot: scene,
      style,
      description: 'x y z',
    });
    expect(prompt).toContain(style.fragment);
    expect(prompt).toContain(scene.framing);
    expect(prompt).toContain(scene.purpose);
  });

  it('labels each reference by its position and role', () => {
    const prompt = compileImagePrompt({
      slot: scene,
      style,
      description: 'Ravi and Meera talk',
      references: [
        { role: 'character', label: 'Ravi', imageId: 'a' },
        { role: 'setting', label: 'the counselling room', imageId: 'b' },
        { role: 'style', imageId: 'c' },
      ],
    });
    expect(prompt).toMatch(/Image 1 \(Ravi\): keep this person’s face/);
    expect(prompt).toMatch(
      /Image 2 \(the counselling room\): this is the place/,
    );
    expect(prompt).toMatch(/Image 3: match its rendering style/);
  });

  it('adds each cast member’s fixed appearance', () => {
    const prompt = compileImagePrompt({
      slot: scene,
      style,
      description: 'A quiet moment',
      cast: [
        {
          id: '1',
          name: 'Ravi',
          appearance: 'early 30s, short beard, blue kurta',
        },
      ],
    });
    expect(prompt).toContain('Ravi — early 30s, short beard, blue kurta');
  });

  it('puts a refine instruction first', () => {
    const prompt = compileImagePrompt({
      slot: scene,
      style,
      description: 'A quiet moment',
      refineInstruction: 'make her look more worried',
      references: [{ role: 'refine', imageId: 'r' }],
    });
    expect(
      prompt.startsWith(
        'Edit the attached image. Change only this: make her look more worried',
      ),
    ).toBe(true);
  });

  it('collapses whitespace and trims overlong input', () => {
    const prompt = compileImagePrompt({
      slot: scene,
      style,
      description: `line one\n\n\nline   two ${'x'.repeat(5000)}`,
    });
    expect(prompt).toContain('line one line two');
    expect(prompt.length).toBeLessThan(5000);
  });
});

describe('describeScene', () => {
  it('skips empty parts', () => {
    expect(
      describeScene({
        people: [{ who: 'Ravi', action: 'looks at his phone', expression: '' }],
        setting: '',
        shot: 'medium',
      }),
    ).toBe('People: Ravi, looks at his phone. Shot: medium.');
    expect(describeScene(null)).toBe('');
  });
});
