import type {CircleConfig} from '@/types';

import {SECONDS_IN_MS} from './general';

export const SESSION_END_MODAL_MINUTES = 19;
export const SESSION_END_MODAL_SECONDS = 30;
export const SESSION_AUTO_END_MINUTES = 20;
export const FEEDBACK_MIN_DISPLAY_MS = 10 * SECONDS_IN_MS;
export const LOW_CREDITS_MODAL_DISPLAY_MS = 5 * SECONDS_IN_MS;

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
  ACTIVE = 'ACTIVE',
}

export enum SimulationTabs {
  COURSES = 'COURSES',
  SIMULATIONS = 'SIMULATIONS',
  PATHS = 'PATHS',
  CASES = 'CASES',
}

export enum LearningPathType {
  TRACK = 'track',
  CASE = 'case',
}

export enum SimulationEventStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

export const DEFAULT_MAX_TIME_VALUE = '00:10:00';
export const WARNING_THRESHOLD_SECONDS = 30;
