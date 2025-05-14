export function bytesToInt16Samples(data: number[]) {
  const samples = [];
  for (let i = 0; i < data.length; i += 2) {
    const low = data[i];
    const high = data[i + 1];
    if (high === undefined) break;
    let sample = (high << 8) | low;
    if (sample >= 0x8000) sample -= 0x10000;
    samples.push(sample);
  }
  return samples;
}

export function calculateRMS(samples: number[]) {
  const sumSquares = samples.reduce((acc, val) => acc + val * val, 0);
  const mean = sumSquares / samples.length;
  return Math.sqrt(mean);
}
