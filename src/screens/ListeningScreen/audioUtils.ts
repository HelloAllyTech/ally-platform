import {Dimensions} from 'react-native';

const {width: SCREEN_WIDTH} = Dimensions.get('window');
const BAR_WIDTH = 2.5;
const BAR_MARGIN = 2;
export const NUM_BARS = Math.floor(SCREEN_WIDTH / (BAR_WIDTH + BAR_MARGIN));

// Decodes base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = globalThis.atob
    ? globalThis.atob(base64)
    : Buffer.from(base64, 'base64').toString('binary');
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Maps Exotel audio data to normalized amplitudes for the waveform
export function exotelAudioDataToAmplitudes(audioData: string): number[] {
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
}

export function webRTCAudioDataToAmplitudes(input: {
  type: string;
  data: number[];
}): number[] {
  const byteArray = input?.data || [];
  if (!Array.isArray(byteArray) || byteArray.length < 2) {
    return new Array(NUM_BARS).fill(0);
  }

  const sampleCount = Math.floor(byteArray.length / 2); // 2 bytes per Int16 sample
  const pcmSamples = new Int16Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    const lo = byteArray[i * 2];
    const hi = byteArray[i * 2 + 1];
    // Combine little-endian bytes to Int16
    const val = (hi << 8) | lo;
    pcmSamples[i] = val >= 0x8000 ? val - 0x10000 : val; // Convert unsigned to signed
  }

  const samplesPerBar = Math.floor(pcmSamples.length / NUM_BARS) || 1;
  const amplitudes: number[] = [];

  for (let i = 0; i < NUM_BARS; i++) {
    let sum = 0;
    let count = 0;

    for (let j = 0; j < samplesPerBar; j++) {
      const idx = i * samplesPerBar + j;
      if (idx < pcmSamples.length) {
        sum += Math.abs(pcmSamples[idx]);
        count++;
      }
    }

    const avg = count > 0 ? sum / count : 0;
    amplitudes.push(Math.min(avg / 32768, 1)); // Clamp max to 1
  }

  return amplitudes;
}
