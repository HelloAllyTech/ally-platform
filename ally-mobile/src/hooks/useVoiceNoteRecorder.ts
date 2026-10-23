import {useCallback, useEffect, useRef, useState} from 'react';
import RNFS from 'react-native-fs';
import LiveAudioStream from 'react-native-live-audio-stream';
import {check, request, RESULTS} from 'react-native-permissions';

import {MICROPHONE_PERMISSION} from '@/constants';
import {isIOS, MICROPHONE_AUDIO_SAMPLE_RATE} from '@/constants/general';
import {logger} from '@/utils/logger';

export type VoiceRecorderStatus = 'idle' | 'recording' | 'paused' | 'stopped';

export type VoiceRecorderError = 'permission' | 'generic' | null;

export interface UseVoiceNoteRecorderResult {
  status: VoiceRecorderStatus;
  isRecording: boolean;
  isPaused: boolean;
  /** Elapsed recorded time in milliseconds (excludes paused spans). */
  durationMs: number;
  /** file:// URI of the finished WAV, available once status is "stopped". */
  fileUri: string | null;
  error: VoiceRecorderError;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => Promise<void>;
  /** Discard the recording, delete the file, and release the microphone. */
  reset: () => void;
}

const BYTES_PER_SECOND = MICROPHONE_AUDIO_SAMPLE_RATE * 2; // 16-bit mono PCM

// The backend caps the multipart upload at 25MB; stop just under it.
const MAX_RECORDING_BYTES = 24 * 1024 * 1024;

const WAV_HEADER_BYTES = 44;

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64-encode a small byte array (used only for the 44-byte WAV header). */
const bytesToBase64 = (bytes: Uint8Array): string => {
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    // eslint-disable-next-line no-bitwise
    output += BASE64_ALPHABET[b0 >> 2];
    // eslint-disable-next-line no-bitwise
    output += BASE64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    output +=
      i + 1 < bytes.length
        ? // eslint-disable-next-line no-bitwise
          BASE64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)]
        : '=';
    // eslint-disable-next-line no-bitwise
    output += i + 2 < bytes.length ? BASE64_ALPHABET[b2 & 63] : '=';
  }
  return output;
};

/** Decoded byte length of a base64 string (accounts for padding). */
const base64ByteLength = (b64: string): number => {
  let padding = 0;
  if (b64.endsWith('==')) padding = 2;
  else if (b64.endsWith('=')) padding = 1;
  return (b64.length / 4) * 3 - padding;
};

/** Standard 44-byte PCM WAV header for 16kHz/16-bit/mono audio. */
const buildWavHeader = (dataBytes: number): Uint8Array => {
  const header = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(header.buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      header[offset + i] = text.charCodeAt(i);
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, MICROPHONE_AUDIO_SAMPLE_RATE, true);
  view.setUint32(28, BYTES_PER_SECOND, true);
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return header;
};

/**
 * Records microphone dictation to a WAV file with start/pause/resume/stop
 * controls, for the manual scribe-note voice flow (the RN counterpart of the
 * web MediaRecorder hook). PCM chunks stream from react-native-live-audio-stream
 * and are appended to the file as they arrive — a placeholder header is written
 * first and patched with the real sizes on stop — so memory use stays flat no
 * matter how long the dictation runs. The produced file is handed to the
 * "Generate notes" upload and then deleted; audio is never persisted.
 */
export const useVoiceNoteRecorder = (): UseVoiceNoteRecorderResult => {
  const [status, setStatus] = useState<VoiceRecorderStatus>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [error, setError] = useState<VoiceRecorderError>(null);

  const filePathRef = useRef<string>(
    `${RNFS.CachesDirectoryPath}/voice-note-dictation.wav`,
  );
  // Serialises the async file appends so chunks land in arrival order.
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const dataBytesRef = useRef(0);
  // Gates the data listener: chunks may still arrive briefly after the native
  // stream is stopped (pause/stop), and must not be written then.
  const capturingRef = useRef(false);
  const dataListenerAttachedRef = useRef(false);
  const stopRef = useRef<() => Promise<void>>(async () => {});

  const enqueueChunk = useCallback((base64Chunk: string) => {
    if (!capturingRef.current || !base64Chunk) return;
    const chunkBytes = base64ByteLength(base64Chunk);
    dataBytesRef.current += chunkBytes;
    setDurationMs(Math.round((dataBytesRef.current / BYTES_PER_SECOND) * 1000));
    writeQueueRef.current = writeQueueRef.current
      .then(() => RNFS.appendFile(filePathRef.current, base64Chunk, 'base64'))
      .catch(err => {
        logger.error(`Voice note chunk write failed: ${err}`);
        setError('generic');
      });
    if (dataBytesRef.current >= MAX_RECORDING_BYTES) {
      // Hit the upload cap — finish the recording instead of dropping audio.
      stopRef.current();
    }
  }, []);

  const initStream = useCallback(() => {
    LiveAudioStream?.init?.({
      sampleRate: MICROPHONE_AUDIO_SAMPLE_RATE,
      channels: 1,
      bitsPerSample: 16,
      audioSource: isIOS ? 1 : 7,
      bufferSize: 4096,
      wavFile: 'voice-note-buffer.wav',
    });
    // The lib exposes only a global listener; attach once and gate writes with
    // capturingRef so stale events after stop/pause are ignored.
    if (!dataListenerAttachedRef.current) {
      LiveAudioStream?.on?.('data', enqueueChunk);
      dataListenerAttachedRef.current = true;
    }
  }, [enqueueChunk]);

  const start = useCallback(async () => {
    try {
      let permission = await check(MICROPHONE_PERMISSION);
      if (permission !== RESULTS.GRANTED) {
        permission = await request(MICROPHONE_PERMISSION);
      }
      if (permission !== RESULTS.GRANTED) {
        setError('permission');
        return;
      }

      // Fresh recording — reset file and counters.
      dataBytesRef.current = 0;
      setDurationMs(0);
      setFileUri(null);
      setError(null);
      writeQueueRef.current = RNFS.writeFile(
        filePathRef.current,
        bytesToBase64(buildWavHeader(0)),
        'base64',
      );

      initStream();
      capturingRef.current = true;
      LiveAudioStream?.start?.();
      setStatus('recording');
    } catch (err) {
      logger.error(`Voice note recording failed to start: ${err}`);
      capturingRef.current = false;
      setError('generic');
      setStatus('idle');
    }
  }, [initStream]);

  const pause = useCallback(() => {
    if (status !== 'recording') return;
    capturingRef.current = false;
    LiveAudioStream?.stop?.();
    setStatus('paused');
  }, [status]);

  const resume = useCallback(() => {
    if (status !== 'paused') return;
    capturingRef.current = true;
    LiveAudioStream?.start?.();
    setStatus('recording');
  }, [status]);

  const stop = useCallback(async () => {
    if (status !== 'recording' && status !== 'paused') return;
    capturingRef.current = false;
    LiveAudioStream?.stop?.();
    try {
      // Let pending appends land, then patch the header with the real sizes.
      await writeQueueRef.current;
      await RNFS.write(
        filePathRef.current,
        bytesToBase64(buildWavHeader(dataBytesRef.current)),
        0,
        'base64',
      );
      setFileUri(`file://${filePathRef.current}`);
      setStatus('stopped');
    } catch (err) {
      logger.error(`Voice note recording failed to finalise: ${err}`);
      setError('generic');
      setStatus('idle');
    }
  }, [status]);
  stopRef.current = stop;

  const reset = useCallback(() => {
    capturingRef.current = false;
    LiveAudioStream?.stop?.();
    const path = filePathRef.current;
    writeQueueRef.current = writeQueueRef.current
      .then(() => RNFS.unlink(path))
      .catch(() => {
        // File may not exist — nothing to clean up.
      });
    dataBytesRef.current = 0;
    setDurationMs(0);
    setFileUri(null);
    setError(null);
    setStatus('idle');
  }, []);

  // Release the microphone if the consumer unmounts mid-recording.
  useEffect(() => {
    return () => {
      if (capturingRef.current) {
        capturingRef.current = false;
        LiveAudioStream?.stop?.();
      }
    };
  }, []);

  return {
    status,
    isRecording: status === 'recording',
    isPaused: status === 'paused',
    durationMs,
    fileUri,
    error,
    start,
    pause,
    resume,
    stop,
    reset,
  };
};
