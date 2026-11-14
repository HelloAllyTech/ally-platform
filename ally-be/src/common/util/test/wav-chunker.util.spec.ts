import {
  chunkWavBySeconds,
  parseWavHeader,
  wavDurationSeconds,
} from '../wav-chunker.util';

/** Builds a minimal, valid mono 16-bit PCM WAV buffer of the given duration. */
function buildWav({
  seconds,
  sampleRate = 16000,
  numChannels = 1,
  bitsPerSample = 16,
}: {
  seconds: number;
  sampleRate?: number;
  numChannels?: number;
  bitsPerSample?: number;
}): Buffer {
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataLength = Math.round(sampleRate * seconds) * blockAlign;
  const byteRate = sampleRate * blockAlign;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataLength, 40);

  // Non-zero, distinguishable sample bytes (incrementing), so a test can
  // confirm chunks are cut at the exact byte and carry no overlap or gaps.
  const data = Buffer.alloc(dataLength);
  for (let i = 0; i < dataLength; i++) data[i] = i % 256;

  return Buffer.concat([header, data]);
}

describe('parseWavHeader', () => {
  it('reads fmt and data chunk info from a well-formed WAV', () => {
    const wav = buildWav({ seconds: 2 });
    const info = parseWavHeader(wav);
    expect(info).toEqual({
      numChannels: 1,
      sampleRate: 16000,
      bitsPerSample: 16,
      dataOffset: 44,
      dataLength: 16000 * 2 * 2,
    });
  });

  it('returns null for a non-WAV buffer', () => {
    expect(parseWavHeader(Buffer.from('not a wav file at all'))).toBeNull();
  });

  it('returns null for a WAV with no data chunk', () => {
    const noData = buildWav({ seconds: 1 }).subarray(0, 44);
    expect(parseWavHeader(noData)).toBeNull();
  });
});

describe('wavDurationSeconds', () => {
  it('computes duration from sample rate, channels and bit depth', () => {
    const info = parseWavHeader(buildWav({ seconds: 5, sampleRate: 16000 }))!;
    expect(wavDurationSeconds(info)).toBeCloseTo(5, 5);
  });
});

describe('chunkWavBySeconds', () => {
  it('returns the original buffer unchanged when already short enough', () => {
    const wav = buildWav({ seconds: 30 });
    const chunks = chunkWavBySeconds(wav, 240);
    expect(chunks).toEqual([wav]);
  });

  it('returns the original buffer unchanged for a non-WAV buffer', () => {
    const notWav = Buffer.from('definitely not a wav file');
    expect(chunkWavBySeconds(notWav, 240)).toEqual([notWav]);
  });

  it('splits a long recording into chunks of the requested length, with no data lost', () => {
    // 10 minutes split into 4-minute chunks: 4, 4, 2.
    const wav = buildWav({ seconds: 600 });
    const originalInfo = parseWavHeader(wav)!;
    const chunks = chunkWavBySeconds(wav, 240);

    expect(chunks).toHaveLength(3);

    const durations = chunks.map((c) => wavDurationSeconds(parseWavHeader(c)!));
    expect(durations[0]).toBeCloseTo(240, 5);
    expect(durations[1]).toBeCloseTo(240, 5);
    expect(durations[2]).toBeCloseTo(120, 5);

    // Every chunk is independently a valid, parseable WAV with the same
    // format as the source.
    for (const chunk of chunks) {
      const info = parseWavHeader(chunk)!;
      expect(info.sampleRate).toBe(originalInfo.sampleRate);
      expect(info.numChannels).toBe(originalInfo.numChannels);
      expect(info.bitsPerSample).toBe(originalInfo.bitsPerSample);
    }

    // Concatenating every chunk's PCM data reproduces the original data
    // exactly — nothing is dropped, duplicated, or reordered at the cuts.
    const reassembled = Buffer.concat(
      chunks.map((c) => {
        const info = parseWavHeader(c)!;
        return c.subarray(info.dataOffset, info.dataOffset + info.dataLength);
      }),
    );
    const originalData = wav.subarray(
      originalInfo.dataOffset,
      originalInfo.dataOffset + originalInfo.dataLength,
    );
    expect(reassembled.equals(originalData)).toBe(true);
  });

  it('cuts on whole-sample boundaries', () => {
    // An odd chunk length in seconds, against a sample rate that doesn't
    // divide evenly, to make sure a cut never lands inside a sample frame.
    const wav = buildWav({
      seconds: 13,
      sampleRate: 16000,
      numChannels: 2,
      bitsPerSample: 16,
    });
    const chunks = chunkWavBySeconds(wav, 5);
    const blockAlign = 2 * (16 / 8);
    for (const chunk of chunks) {
      const info = parseWavHeader(chunk)!;
      expect(info.dataLength % blockAlign).toBe(0);
    }
  });
});
