/**
 * Every place an author can generate an image, with the shape the image is
 * shown at. The provider renders at its nearest native size (OpenAI offers
 * only three) and the post-processor crops to `width`×`height` exactly, so a
 * slot that validates its uploads at strict 16:9 accepts a generated image too.
 */
export enum ImageSlotKind {
  COURSE_COVER = 'course_cover',
  ROLEPLAY_COVER = 'roleplay_cover',
  CASE_COVER = 'case_cover',
  PATH_COVER = 'path_cover',
  CHARACTER_PORTRAIT = 'character_portrait',
  PERSONA_PORTRAIT = 'persona_portrait',
  ARTICLE_COVER = 'article_cover',
  ARTICLE_INLINE = 'article_inline',
  QUIZ_QUESTION = 'quiz_question',
  SCENE = 'scene',
  BADGE_ICON = 'badge_icon',
  /** A character reference sheet: never shown to learners, fed back as a reference. */
  CAST_SHEET = 'cast_sheet',
}

export type ImageAspectRatio = '16:9' | '1:1' | '3:2';

/** Provider-native sizes. OpenAI's image models accept only these three. */
export type ProviderImageSize = '1536x1024' | '1024x1024' | '1024x1536';

export interface ImageSlotProfile {
  kind: ImageSlotKind;
  label: string;
  width: number;
  height: number;
  aspectRatio: ImageAspectRatio;
  /** The size asked of the provider before cropping. */
  providerSize: ProviderImageSize;
  /** Whether the editor offers the references tray (refine works everywhere). */
  allowsReferences: boolean;
  defaultStyleId: string;
  defaultVariants: 1 | 2;
  /**
   * How the picture must be composed so the crop and the display work: a
   * circle crop needs the face centred with room around it, an icon needs one
   * bold shape. Compiled into every prompt for the slot.
   */
  framing: string;
  /** What the picture is for, in a few words, for the scene-spec writer. */
  purpose: string;
}

const WIDE = {
  width: 1600,
  height: 900,
  aspectRatio: '16:9' as const,
  providerSize: '1536x1024' as const,
};

const SQUARE = {
  width: 768,
  height: 768,
  aspectRatio: '1:1' as const,
  providerSize: '1024x1024' as const,
};

const WIDE_SAFE_AREA =
  'Wide 16:9 landscape composition. Keep the main subject inside the central ' +
  'two-thirds so the edges can be trimmed for cards.';

export const IMAGE_SLOT_PROFILES: Record<ImageSlotKind, ImageSlotProfile> = {
  [ImageSlotKind.COURSE_COVER]: {
    kind: ImageSlotKind.COURSE_COVER,
    label: 'Course cover',
    ...WIDE,
    allowsReferences: false,
    defaultStyleId: 'documentary_photo',
    defaultVariants: 2,
    framing: WIDE_SAFE_AREA,
    purpose:
      'the cover image of a whole training course, shown on the course card',
  },
  [ImageSlotKind.ROLEPLAY_COVER]: {
    kind: ImageSlotKind.ROLEPLAY_COVER,
    label: 'Roleplay cover',
    ...WIDE,
    allowsReferences: false,
    defaultStyleId: 'documentary_photo',
    defaultVariants: 2,
    framing:
      'Wide 16:9 portrait of the person the learner will talk to: head and ' +
      'shoulders, facing the camera, centred, with space on both sides.',
    purpose:
      'the cover of a roleplay: a portrait of the simulated client the learner practises with',
  },
  [ImageSlotKind.CASE_COVER]: {
    kind: ImageSlotKind.CASE_COVER,
    label: 'Case cover',
    ...WIDE,
    allowsReferences: false,
    defaultStyleId: 'documentary_photo',
    defaultVariants: 2,
    framing: WIDE_SAFE_AREA,
    purpose: 'the cover of a multi-session client case',
  },
  [ImageSlotKind.PATH_COVER]: {
    kind: ImageSlotKind.PATH_COVER,
    label: 'Path cover',
    ...WIDE,
    allowsReferences: false,
    defaultStyleId: 'documentary_photo',
    defaultVariants: 2,
    framing: WIDE_SAFE_AREA,
    purpose: 'the cover of a learning path made of several roleplays',
  },
  [ImageSlotKind.CHARACTER_PORTRAIT]: {
    kind: ImageSlotKind.CHARACTER_PORTRAIT,
    label: 'Character portrait',
    ...WIDE,
    allowsReferences: true,
    defaultStyleId: 'documentary_photo',
    defaultVariants: 2,
    framing:
      'Head-and-shoulders portrait, face exactly centred and looking at the ' +
      'camera, plain softly lit background, generous space around the head so ' +
      'the image can also be cropped to a circle.',
    purpose: 'the portrait of a reusable character from the character library',
  },
  [ImageSlotKind.PERSONA_PORTRAIT]: {
    kind: ImageSlotKind.PERSONA_PORTRAIT,
    label: 'Persona portrait',
    ...SQUARE,
    allowsReferences: true,
    defaultStyleId: 'documentary_photo',
    defaultVariants: 2,
    framing:
      'Square head-and-shoulders portrait, face centred, plain background, ' +
      'space around the head: it is shown as a small circle.',
    purpose: "the small round portrait on a course's landing page",
  },
  [ImageSlotKind.ARTICLE_COVER]: {
    kind: ImageSlotKind.ARTICLE_COVER,
    label: 'Article cover',
    ...WIDE,
    allowsReferences: true,
    defaultStyleId: 'documentary_photo',
    defaultVariants: 2,
    framing: WIDE_SAFE_AREA,
    purpose: 'the header image of an article inside a course',
  },
  [ImageSlotKind.ARTICLE_INLINE]: {
    kind: ImageSlotKind.ARTICLE_INLINE,
    label: 'Article illustration',
    ...WIDE,
    allowsReferences: true,
    defaultStyleId: 'warm_illustration',
    defaultVariants: 2,
    framing: 'Wide 16:9 illustration with a clear single focal point.',
    purpose: 'an illustration placed between paragraphs of an article',
  },
  [ImageSlotKind.QUIZ_QUESTION]: {
    kind: ImageSlotKind.QUIZ_QUESTION,
    label: 'Quiz question image',
    ...WIDE,
    allowsReferences: true,
    defaultStyleId: 'warm_illustration',
    defaultVariants: 2,
    framing:
      'Wide 16:9 image of one clear situation. It must not give away the ' +
      'answer to the question.',
    purpose: 'the picture shown above a quiz question',
  },
  [ImageSlotKind.SCENE]: {
    kind: ImageSlotKind.SCENE,
    label: 'Scene image',
    width: 1920,
    height: 1080,
    aspectRatio: '16:9',
    providerSize: '1536x1024',
    allowsReferences: true,
    defaultStyleId: 'cinematic_photo',
    defaultVariants: 1,
    framing:
      'A single moment in a story, shot like a film still: medium or wide ' +
      'shot, the people’s body language carries the emotion, subject inside ' +
      'the central area because it is shown full screen on phones too.',
    purpose:
      'one scene of a situational-judgement story in which the learner makes choices',
  },
  [ImageSlotKind.BADGE_ICON]: {
    kind: ImageSlotKind.BADGE_ICON,
    label: 'Badge icon',
    width: 512,
    height: 512,
    aspectRatio: '1:1',
    providerSize: '1024x1024',
    allowsReferences: false,
    defaultStyleId: 'soft_3d',
    defaultVariants: 2,
    framing:
      'One simple emblem centred on a plain light background, bold shapes ' +
      'that stay readable at 64 pixels, no fine detail, no text.',
    purpose: 'an achievement badge icon',
  },
  [ImageSlotKind.CAST_SHEET]: {
    kind: ImageSlotKind.CAST_SHEET,
    label: 'Cast sheet',
    width: 1536,
    height: 1024,
    aspectRatio: '3:2',
    providerSize: '1536x1024',
    allowsReferences: true,
    defaultStyleId: 'documentary_photo',
    defaultVariants: 1,
    framing:
      'A character reference sheet: the SAME person shown three times side ' +
      'by side on a plain light background — front view, three-quarter view ' +
      'and full body — neutral pose, the same clothing in all three.',
    purpose:
      'a reference sheet that keeps one character looking the same in every later image',
  },
};

export const getSlotProfile = (kind: ImageSlotKind): ImageSlotProfile =>
  IMAGE_SLOT_PROFILES[kind];
