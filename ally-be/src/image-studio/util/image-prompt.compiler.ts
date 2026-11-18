import { IMAGE_GUARDRAILS } from '../constants/image-safety.constants';
import { ImageSlotProfile } from '../constants/image-slots.constants';
import { ImageStyleDefinition } from '../constants/image-styles.constants';
import { StoredImageReference } from '../entity/generated-image.entity';

export interface ImageSceneSpec {
  people?: { who?: string; action?: string; expression?: string }[];
  setting?: string;
  shot?: string;
  mood?: string;
  lighting?: string;
}

export interface CastMember {
  id: string;
  name: string;
  appearance?: string | null;
}

export interface CompileImagePromptInput {
  slot: ImageSlotProfile;
  style: ImageStyleDefinition;
  description: string;
  scene?: ImageSceneSpec | null;
  cast?: CastMember[];
  /** In the order they are sent to the provider. */
  references?: StoredImageReference[];
  refineInstruction?: string;
}

const REFERENCE_INSTRUCTIONS: Record<StoredImageReference['role'], string> = {
  character:
    'keep this person’s face, age, skin tone, hair, build and clothing exactly the same',
  setting: 'this is the place: keep its layout, furniture, colours and light',
  style:
    'match its rendering style, palette, texture and line quality only — not its content or people',
  previous:
    'the previous moment of the same story: keep continuity of the people, clothing, place and light, but use a new pose and camera angle',
  refine:
    'the image to change: keep everything about it except what the change below asks for',
};

const clean = (value: unknown, max = 300): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : '';

/** The scene spec as two or three plain sentences; empty parts are skipped. */
export const describeScene = (scene?: ImageSceneSpec | null): string => {
  if (!scene) return '';
  const people = (scene.people ?? [])
    .map((person) =>
      [
        clean(person.who, 80),
        clean(person.action, 160),
        clean(person.expression, 100),
      ]
        .filter(Boolean)
        .join(', '),
    )
    .filter(Boolean);
  const parts = [
    people.length ? `People: ${people.join('; ')}.` : '',
    clean(scene.setting) ? `Setting: ${clean(scene.setting)}.` : '',
    clean(scene.shot, 40) ? `Shot: ${clean(scene.shot, 40)}.` : '',
    clean(scene.mood, 120) ? `Mood: ${clean(scene.mood, 120)}.` : '',
    clean(scene.lighting, 120)
      ? `Lighting: ${clean(scene.lighting, 120)}.`
      : '',
  ];
  return parts.filter(Boolean).join(' ');
};

/**
 * The prompt sent to the image provider. Deterministic and provider-neutral:
 * what the picture is (the author's description, made concrete by the scene
 * spec), how it looks (the style), how it is framed (the slot), who must be
 * recognisable (cast appearance text), what each attached image is (labelled
 * by position, which is how both providers expect references to be named),
 * and the guardrails, which come last and are never optional.
 */
export const compileImagePrompt = (input: CompileImagePromptInput): string => {
  const sections: string[] = [];

  if (input.refineInstruction) {
    sections.push(
      `Edit the attached image. Change only this: ${clean(input.refineInstruction, 500)}`,
    );
  }

  sections.push(`Create ${input.slot.purpose}.`);
  sections.push(`Picture: ${clean(input.description, 2000)}`);
  const scene = describeScene(input.scene);
  if (scene) sections.push(scene);

  const cast = (input.cast ?? []).filter((member) => clean(member.name, 80));
  if (cast.length) {
    sections.push(
      'Characters (keep each one exactly as described in every image): ' +
        cast
          .map((member) =>
            clean(member.appearance, 500)
              ? `${clean(member.name, 80)} — ${clean(member.appearance, 500)}`
              : clean(member.name, 80),
          )
          .join('; ') +
        '.',
    );
  }

  const references = input.references ?? [];
  if (references.length) {
    sections.push(
      'Attached reference images, in order:\n' +
        references
          .map((reference, index) => {
            const label = clean(reference.label, 80);
            return `Image ${index + 1}${label ? ` (${label})` : ''}: ${REFERENCE_INSTRUCTIONS[reference.role]}.`;
          })
          .join('\n'),
    );
  }

  sections.push(`Style: ${input.style.fragment}`);
  sections.push(`Framing: ${input.slot.framing}`);
  sections.push(`Rules: ${IMAGE_GUARDRAILS.join(' ')}`);

  return sections.join('\n\n');
};
