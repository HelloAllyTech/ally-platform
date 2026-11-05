import {
  base64ToUint8Array,
  exotelAudioDataToAmplitudes,
  recorderAudioToAmplitudes,
  getStartAudioChatPayload,
  NUM_BARS,
} from '../audioUtils';

jest.mock('@/constants/general', () => ({
  SCREEN_WIDTH: 100,
  isIOS: false,
  AllyPlatforms: {MOBILE: 'MOBILE'},
  MICROPHONE_AUDIO_SAMPLE_RATE: 16000,
}));

describe('audioUtils', () => {
  it('converts base64 to Uint8Array', () => {
    const b64 = Buffer.from('hello').toString('base64');
    const arr = base64ToUint8Array(b64);
    expect(arr).toBeInstanceOf(Uint8Array);
    expect(arr.length).toBe(5);
  });

  it('maps exotel data to amplitudes', () => {
    const b64 = Buffer.from([0, 128, 255, 64, 32, 16, 8, 4]).toString('base64');
    const amps = exotelAudioDataToAmplitudes(b64);
    expect(Array.isArray(amps)).toBe(true);
    expect(amps.length).toBe(NUM_BARS);
  });

  it('maps recorder audio (fake PCM bytes) to amplitudes', () => {
    // simple 16-bit PCM little-endian samples without WAV header
    const bytes = Buffer.from([0, 0, 255, 127, 0, 128, 0, 1]);
    const b64 = bytes.toString('base64');
    const amps = recorderAudioToAmplitudes(b64);
    expect(amps.length).toBe(NUM_BARS);
  });

  it('builds start audio payload with default SCRIBE mode', () => {
    const payload = getStartAudioChatPayload();
    expect(payload.platform).toBe('MOBILE');
    expect(payload.sampleRate).toBe(16000);
    expect(payload.isLinear16Encoded).toBe(true);
    expect(payload.mode).toBe('SCRIBE');
  });

  it('never starts a session in the retired dictation mode', () => {
    const payload = getStartAudioChatPayload();
    expect(payload.mode).not.toBe('DICTATION');
  });
});
