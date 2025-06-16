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

// Maps audio data to normalized amplitudes for the waveform
export function audioDataToAmplitudes(audioData: string): number[] {
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
