import type {CircleConfig} from '@/types';

const AUDIO = {
  FFT_SIZE: 256,
  NORMALIZATION_FACTOR: 128,
  THRESHOLD: 0.01,
} as const;

const CIRCLE = {
  BASE_SIZE: 60,
  TRANSITION_MS: 200,
  MIN_SCALE: 1,
  BORDER: {
    WIDTH: 0.5,
    COLOR: 'rgba(45, 115, 186, 0.3)',
  },
  GRADIENT: {
    START_COLOR: '45, 115, 186', // RGB for #2D73BA
    END_COLOR: '231, 244, 255', // RGB for #E7F4FF
    ANGLE: 180,
  },
} as const;

const CIRCLE_CONFIGS: CircleConfig[] = [
  {scale: 1, isStatic: true},
  {scale: 2, isStatic: true},
  {scale: 3, isStatic: false},
  {scale: 4, isStatic: false},
];

export {AUDIO, CIRCLE, CIRCLE_CONFIGS};
