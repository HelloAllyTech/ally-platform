import {AUDIO_INACTIVE_TIMEOUT, CHAT_TYPES} from '../chat';

describe('constants/chat', () => {
  it('defines audio timeout and chat types', () => {
    expect(AUDIO_INACTIVE_TIMEOUT).toBeGreaterThan(0);
    expect(CHAT_TYPES.MICROPHONE_CHAT).toBe('MICROPHONE_CHAT');
  });
});
