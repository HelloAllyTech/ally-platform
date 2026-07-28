import {ScribeSessionMode} from '@/constants';
import {
  AllyPlatforms,
  isIOS,
  MICROPHONE_AUDIO_SAMPLE_RATE,
  SCREEN_WIDTH,
} from '@/constants/general';
import {logger} from '@/utils';

const BAR_WIDTH = 2.5;
const BAR_MARGIN = 2;
export const NUM_BARS = Math.floor(SCREEN_WIDTH / (BAR_WIDTH + BAR_MARGIN));

// Decodes base64 to Uint8Array.
// Runs on every audio frame from a native event callback, so it must never
// throw: a strict `atob` rejects malformed/partial chunks and `Buffer` may be
// absent on some Hermes builds. Either would escape the callback and crash the
// app. On failure we return an empty array and let the caller skip the frame.
export const base64ToUint8Array = (base64: string): Uint8Array => {
  try {
    const decode = globalThis.atob;
    const binary =
      typeof decode === 'function'
        ? decode(base64)
        : Buffer.from(base64, 'base64').toString('binary');
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (error) {
    logger.error(`base64ToUint8Array decode failed: ${error}`);
    return new Uint8Array(0);
  }
};

// Maps Exotel audio data to normalized amplitudes for the waveform
export const exotelAudioDataToAmplitudes = (audioData: string): number[] => {
  const samples = base64ToUint8Array(audioData);
  const samplesPerBar = Math.floor(samples.length / NUM_BARS) || 1;
  const amplitudes: number[] = [];
  for (let i = 0; i < NUM_BARS; i++) {
    let sum = 0;
    let count = 0;
    for (let j = 0; j < samplesPerBar; j++) {
      const idx = i * samplesPerBar + j;
      if (idx < samples.length) {
        sum += samples[idx];
        count++;
      }
    }
    // Average and normalize (0-255 to 0-1)
    const avg = count > 0 ? sum / count : 0;
    amplitudes.push(avg / 255);
  }
  return amplitudes;
};

export const recorderAudioToAmplitudes = (base64Audio: string): number[] => {
  const audioBytes = base64ToUint8Array(base64Audio);

  const WAV_HEADER_SIZE = 44;
  const isWav = String.fromCharCode(...audioBytes.slice(0, 4)) === 'RIFF';
  const pcmData = isWav ? audioBytes.slice(WAV_HEADER_SIZE) : audioBytes;

  const sampleCount = Math.floor(pcmData.length / 2);
  const pcmSamples = new Int16Array(sampleCount);

  let globalMax = 0;
  for (let i = 0; i < sampleCount; i++) {
    const lo = pcmData[i * 2];
    const hi = pcmData[i * 2 + 1];
    const val = hi * 256 + lo; // avoid bitwise shift for lint
    const sample = val >= 0x8000 ? val - 0x10000 : val;
    pcmSamples[i] = sample;
    globalMax = Math.max(globalMax, Math.abs(sample));
  }

  const samplesPerBar = Math.floor(sampleCount / NUM_BARS) || 1;
  const amplitudes: number[] = [];

  const scale = globalMax > 0 ? 1 / (globalMax / 32768) : 1;
  const PLATFORM_GAIN = isIOS ? 3.0 : 1.0;

  for (let i = 0; i < NUM_BARS; i++) {
    let sum = 0;
    let count = 0;

    for (let j = 0; j < samplesPerBar; j++) {
      const idx = i * samplesPerBar + j;
      if (idx < sampleCount) {
        sum += Math.abs(pcmSamples[idx]);
        count++;
      }
    }

    const avg = count > 0 ? sum / count : 0;
    let normalized = avg / 32768;

    normalized *= scale * PLATFORM_GAIN;
    normalized = Math.min(normalized, 1);

    if (globalMax < 500) {
      normalized = 0.02;
    }

    amplitudes.push(Math.max(normalized, 0.02));
  }

  return amplitudes;
};

// Live dictation sessions are retired, so every mic session the app starts is a
// SCRIBE one. Existing DICTATION recordings and manual notes are unaffected —
// only this entry point is gone.
export const getStartAudioChatPayload = () => ({
  isLinear16Encoded: true,
  platform: AllyPlatforms.MOBILE,
  sampleRate: MICROPHONE_AUDIO_SAMPLE_RATE,
  mode: ScribeSessionMode.SCRIBE,
});
