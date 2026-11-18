import axios from 'axios';
import { LoggerService } from '../../logger/logger.service';

const logger = LoggerService.getInstance('AudioUtil');

export function checkAudioFileReady(audioUrl: string): Promise<boolean> {
  return axios
    .head(audioUrl, { timeout: 5000 })
    .then((response) => {
      if (response.status === 200) {
        return true;
      }
      return false;
    })
    .catch((error) => {
      logger.error(`Error checking audio file ready: ${error}`);
      return false;
    });
}

export function generateAudioStorageKey(params: {
  chatId?: number;
  key?: string;
  extension?: string;
  prefix?: string;
}): string {
  const { chatId, key, extension, prefix } = params;
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const timestamp = now.getTime();
  const defaultKey = `chat-${chatId}-${timestamp}`;
  const finalKey = key || defaultKey;
  return `${prefix ? `${prefix}/` : ''}${year}/${month}/${day}/${finalKey}${
    extension ? `.${extension}` : ''
  }`;
}

/**
 * OpenAI's transcription API infers the container from the filename extension, so the
 * extension is derived from the real MIME type rather than the client-sent filename
 * (Safari records audio/mp4, Chromium audio/webm). Unknown types fall back to webm.
 */
const AUDIO_MIME_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
};

/** The bare MIME type (codecs parameter dropped) and the extension a transcriber expects. */
export function audioUploadType(mimetype: string | undefined): {
  type: string;
  ext: string;
} {
  const type = (mimetype || 'audio/webm').split(';')[0].trim();
  return { type, ext: AUDIO_MIME_EXTENSIONS[type.toLowerCase()] ?? 'webm' };
}
