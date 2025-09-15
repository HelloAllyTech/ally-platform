import type {CircleConfig} from '@/types';

export const SESSION_END_MODAL_MINUTES = 29;
export const SESSION_END_MODAL_SECONDS = 30;
export const SESSION_AUTO_END_MINUTES = 30;

export const AUDIO = {
  FFT_SIZE: 256,
  NORMALIZATION_FACTOR: 128,
  THRESHOLD: 0.01,
} as const;

export const CIRCLE = {
  BASE_SIZE: 60,
  TRANSITION_MS: 200,
  MIN_SCALE: 1,
  BORDER: {
    WIDTH: 0.5,
    COLOR: 'rgba(86, 109, 140, 0.25)',
  },
  GRADIENT: {
    START_COLOR: '84, 103, 132', // ~ #546784
    END_COLOR: '26, 33, 42', // ~ #1A212A
    ANGLE: 180,
  },
} as const;

export const CIRCLE_CONFIGS: CircleConfig[] = [
  {scale: 3, isStatic: false},
  {scale: 4, isStatic: false},
];

export const FEEDBACK_OPTIONS = {
  1: 'Poor Experience',
  2: 'Below Average',
  3: 'Average',
  4: 'Nice Experience!',
  5: 'Excellent Experience!',
};

export enum ScenarioStatus {
  COMING_SOON = 'COMING_SOON',
}
