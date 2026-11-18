import { ImageSlotKind } from './image-slots.constants';

/**
 * The style gallery. Kept in code on purpose: a style's wording is tuned
 * against the eval set (`src/image-studio/scripts/eval.ts`) and a change ships as
 * a reviewed diff, not an unreviewed edit in production. Organisation-specific
 * styles, when they come, need a table; this list stays the platform set.
 *
 * `fragment` describes how the picture looks and nothing about what is in it.
 * Gallery thumbnails are the same subject rendered in every style
 * (`src/image-studio/scripts/thumbnails.ts`), so authors compare like with like.
 */
export interface ImageStyleDefinition {
  id: string;
  name: string;
  description: string;
  kind: 'photo' | 'illustration';
  fragment: string;
  /** Placeholder gradient while a thumbnail is missing. */
  swatch: [string, string];
  recommendedSlots: ImageSlotKind[];
}

export const IMAGE_STYLES: ImageStyleDefinition[] = [
  {
    id: 'documentary_photo',
    name: 'Documentary photo',
    description: 'Natural, honest photography of everyday life',
    kind: 'photo',
    fragment:
      'Realistic documentary photograph. Natural window light, true-to-life ' +
      'colour, candid and unposed, real everyday places and clothing, shallow ' +
      'depth of field. No glamour, no studio gloss.',
    swatch: ['#c9b8a3', '#6b7a6f'],
    recommendedSlots: [
      ImageSlotKind.COURSE_COVER,
      ImageSlotKind.ROLEPLAY_COVER,
      ImageSlotKind.CASE_COVER,
      ImageSlotKind.PATH_COVER,
      ImageSlotKind.CHARACTER_PORTRAIT,
      ImageSlotKind.PERSONA_PORTRAIT,
      ImageSlotKind.ARTICLE_COVER,
    ],
  },
  {
    id: 'cinematic_photo',
    name: 'Cinematic still',
    description: 'Moody, film-like photographs for story scenes',
    kind: 'photo',
    fragment:
      'Cinematic film still. Soft directional light, gentle contrast, muted ' +
      'colour grade, 35mm lens look, natural expressions, composed like a ' +
      'frame from a quiet drama.',
    swatch: ['#2f3e4e', '#b08d6a'],
    recommendedSlots: [ImageSlotKind.SCENE, ImageSlotKind.ARTICLE_COVER],
  },
  {
    id: 'warm_illustration',
    name: 'Warm illustration',
    description: 'Friendly flat illustration with soft colours',
    kind: 'illustration',
    fragment:
      'Warm flat digital illustration. Simple rounded shapes, soft muted ' +
      'palette of terracotta, sage and cream, subtle paper grain, gentle ' +
      'shading, friendly but grown-up, no outlines on backgrounds.',
    swatch: ['#e0a37b', '#9db59a'],
    recommendedSlots: [
      ImageSlotKind.ARTICLE_INLINE,
      ImageSlotKind.QUIZ_QUESTION,
      ImageSlotKind.SCENE,
      ImageSlotKind.COURSE_COVER,
    ],
  },
  {
    id: 'watercolour',
    name: 'Watercolour',
    description: 'Gentle hand-painted look for sensitive topics',
    kind: 'illustration',
    fragment:
      'Soft watercolour painting. Loose wet-on-wet washes, visible paper ' +
      'texture, light pencil underdrawing, calm pastel palette, lots of white ' +
      'space, quiet and reflective.',
    swatch: ['#a9c4d8', '#e7d3c1'],
    recommendedSlots: [
      ImageSlotKind.ARTICLE_INLINE,
      ImageSlotKind.SCENE,
      ImageSlotKind.COURSE_COVER,
    ],
  },
  {
    id: 'graphic_novel',
    name: 'Graphic novel',
    description: 'Inked panels that keep a story sequence together',
    kind: 'illustration',
    fragment:
      'Graphic novel panel. Clean confident ink lines, flat colour with ' +
      'limited muted palette, soft cel shading, expressive faces and body ' +
      'language, consistent character design, no speech bubbles.',
    swatch: ['#3d4a5c', '#d9a05b'],
    recommendedSlots: [ImageSlotKind.SCENE, ImageSlotKind.QUIZ_QUESTION],
  },
  {
    id: 'line_art',
    name: 'Minimal line art',
    description: 'Simple single-colour drawings, calm and clear',
    kind: 'illustration',
    fragment:
      'Minimal line drawing. Single continuous dark line on an off-white ' +
      'background with one soft accent colour, generous empty space, ' +
      'simplified faces, elegant and calm.',
    swatch: ['#f2efe8', '#4f6d7a'],
    recommendedSlots: [
      ImageSlotKind.ARTICLE_INLINE,
      ImageSlotKind.QUIZ_QUESTION,
    ],
  },
  {
    id: 'soft_3d',
    name: 'Soft 3D',
    description: 'Rounded clay-like 3D, good for icons and badges',
    kind: 'illustration',
    fragment:
      'Soft 3D render with a matte clay look. Rounded forms, soft studio ' +
      'lighting with gentle shadows, pastel palette, simple and tactile.',
    swatch: ['#f3c7b5', '#9fb7e0'],
    recommendedSlots: [ImageSlotKind.BADGE_ICON, ImageSlotKind.ARTICLE_INLINE],
  },
];

export const IMAGE_STYLE_IDS = IMAGE_STYLES.map((style) => style.id);

export const findImageStyle = (id: string): ImageStyleDefinition | undefined =>
  IMAGE_STYLES.find((style) => style.id === id);

/** Where the gallery thumbnail for a style lives in the learn-media bucket. */
export const styleThumbnailKey = (styleId: string): string =>
  `image-studio/styles/${styleId}.webp`;
