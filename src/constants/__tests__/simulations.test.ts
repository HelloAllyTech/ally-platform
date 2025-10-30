import {
  SESSION_END_MODAL_MINUTES,
  SESSION_END_MODAL_SECONDS,
  SESSION_AUTO_END_MINUTES,
  FEEDBACK_MIN_DISPLAY_MS,
  AUDIO,
  CIRCLE,
  CIRCLE_CONFIGS,
  FEEDBACK_OPTIONS,
  ScenarioStatus,
} from '../simulations';

describe('constants/simulations', () => {
  it('timing constants are defined', () => {
    expect(SESSION_END_MODAL_MINUTES).toBeGreaterThan(0);
    expect(SESSION_AUTO_END_MINUTES).toBe(20);
    expect(FEEDBACK_MIN_DISPLAY_MS).toBeGreaterThan(0);
  });
  it('audio and circle configs exist', () => {
    expect(AUDIO.FFT_SIZE).toBe(256);
    expect(CIRCLE.BORDER.WIDTH).toBe(0.5);
    expect(CIRCLE_CONFIGS.length).toBeGreaterThan(0);
  });
  it('feedback options and scenario status exist', () => {
    expect(FEEDBACK_OPTIONS[5]).toContain('Excellent');
    expect(ScenarioStatus.ACTIVE).toBe('ACTIVE');
  });
});
