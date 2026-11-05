import {API_METHODS, API_ROUTES} from '@/constants';

import {api} from './api';

export interface CreateNoteResponse {
  chatId: number;
  name: string;
}

/**
 * A generic, human-readable description of a form field for the voice-note
 * extractor. Mirrors the web client: `id` is the summary field key (built-in)
 * or the custom field definition id, and `options` are the choice labels.
 */
export type VoiceNoteFieldType =
  | 'text'
  | 'multiline'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'boolean';

export interface VoiceNoteFieldSpec {
  id: string;
  label: string;
  type: VoiceNoteFieldType;
  options?: string[];
  hint?: string;
}

export interface GenerateNoteFromAudioInput {
  /** file:// URI of the recorded WAV produced by useVoiceNoteRecorder. */
  fileUri: string;
  fields: VoiceNoteFieldSpec[];
  /** Optional ISO-639-1 language hint; omitted lets the model auto-detect. */
  languageHint?: string;
}

export interface GenerateNoteFromAudioResponse {
  /**
   * Plain-text transcript of the dictation. The generate call itself does not
   * persist it; the caller saves it to the note via `saveNoteTranscript` so it
   * shows in the Transcript view later.
   */
  transcript: string;
  /** Values the model could fill (value is a human-readable string). */
  values: {id: string; value: string}[];
}

export interface SaveNoteTranscriptInput {
  chatId: number;
  /** The full (possibly accumulated) dictation transcript to store. */
  transcript: string;
}

export const scribeNoteApi = api.injectEndpoints({
  endpoints: builder => ({
    /**
     * Creates an empty manual scribe note (a DICTATION chat with no audio).
     * The backend enforces the per-tenant toggle + counsellor permission and
     * returns 403 when either is missing.
     */
    createNote: builder.mutation<CreateNoteResponse, void>({
      query: () => ({
        url: API_ROUTES.CHATS.NOTE,
        method: API_METHODS.POST,
      }),
    }),

    /**
     * Transcribes a dictated recording and extracts scribe-note field values.
     * The audio is processed server-side in memory and never stored. Sent as
     * multipart/form-data; fetchBaseQuery passes FormData through untouched so
     * fetch sets the multipart boundary, and React Native streams the file
     * from its URI without loading it into JS memory.
     */
    generateNoteFromAudio: builder.mutation<
      GenerateNoteFromAudioResponse,
      GenerateNoteFromAudioInput
    >({
      query: ({fileUri, fields, languageHint}) => {
        const formData = new FormData();
        formData.append('audio', {
          uri: fileUri,
          type: 'audio/wav',
          name: 'dictation.wav',
          // RN's FormData file part isn't in the DOM lib types.
        } as unknown as Blob);
        formData.append('fields', JSON.stringify(fields));
        if (languageHint) {
          formData.append('languageHint', languageHint);
        }
        return {
          url: API_ROUTES.CHATS.GENERATE_NOTE_FROM_AUDIO,
          method: API_METHODS.POST,
          body: formData,
        };
      },
    }),

    /**
     * Saves a manual scribe note's dictated transcript so it appears in the
     * note's Transcript view later. Replaces any previously stored transcript
     * (callers re-send the full accumulated dictation), so it is safe to call
     * after every generation.
     */
    saveNoteTranscript: builder.mutation<
      {success: boolean},
      SaveNoteTranscriptInput
    >({
      query: ({chatId, transcript}) => ({
        url: API_ROUTES.CHATS.SAVE_NOTE_TRANSCRIPT(chatId),
        method: API_METHODS.PUT,
        body: {transcript},
      }),
    }),
  }),
});

export const {
  useCreateNoteMutation,
  useGenerateNoteFromAudioMutation,
  useSaveNoteTranscriptMutation,
} = scribeNoteApi;
