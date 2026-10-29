import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ErrorCode } from 'src/exception/error-code.enum';
import { VoiceNoteExtractionFailedException } from 'src/exception/custom.exception';
import { FAILURE_MESSAGES } from 'src/exception/failure-messages';
import OpenAI, { toFile } from 'openai';

import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { SettingsService } from 'src/settings/service/settings.service';
import { toPromptCode } from 'src/prompt/util/prompt-code.util';
import { loadPromptTemplate } from 'src/common/util/prompt-template.util';
import {
  GenerateNoteFromAudioResponseDto,
  VoiceNoteFieldSpec,
  VoiceNoteFieldType,
  VoiceNoteFieldValueDto,
} from '../dto/voice-note.dto';

/** Guard rails so a crafted request can't blow up the prompt/token budget. */
const MAX_FIELDS = 300;
const MAX_LABEL_LEN = 200;
const MAX_HINT_LEN = 500;
const MAX_OPTIONS = 100;
const MAX_TRANSCRIPT_CHARS = 40_000;
/**
 * Output budget for the field-extraction call. On gpt-5-family models this is
 * `max_completion_tokens`, and the model's REASONING tokens count against it
 * alongside the visible JSON — 4096 capped gpt-5-mini on a 25-minute dictation
 * and the note came back empty. 16384 leaves ~7x headroom over the largest
 * observed spend (2,324 tokens at 25 min on the current prompt).
 */
const EXTRACTION_MAX_TOKENS = 16384;
/** Shortest transcript quote accepted as evidence for an extracted value. */
const MIN_EVIDENCE_WORDS = 3;
/** AI-task-registry row id; the key for per-task model config. */
const AI_TASK_ID = 'voice-note-extract';

// OpenAI's transcription API infers the container from the filename extension,
// so we derive the extension from the real MIME type rather than trusting the
// client-sent filename (Safari records audio/mp4, Chromium audio/webm).
const MIME_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
};

const VALID_FIELD_TYPES: ReadonlySet<VoiceNoteFieldType> = new Set([
  'text',
  'multiline',
  'number',
  'select',
  'multiselect',
  'date',
  'boolean',
]);

// Prompt codes for the (superadmin-editable) extraction templates. Their shipped
// defaults are src/prompts/scribe_voice_note/*.txt; the live text is edited in
// the Skills Store. The user template's {{transcript}} and {{fields}} runtime
// variables are filled by renderTemplate before the call.
const SYSTEM_PROMPT_CODE = toPromptCode(
  'scribe_voice_note',
  'field_extraction_system',
);
const USER_PROMPT_CODE = toPromptCode(
  'scribe_voice_note',
  'field_extraction_user',
);

/**
 * Turns a counsellor's spoken dictation into structured scribe-note field
 * values. Two steps, both in-process:
 *   1. Speech-to-text via OpenAI (audio buffer in → text out).
 *   2. Field extraction via Anthropic — the transcript plus the caller-supplied
 *      field structure guide the model to emit a JSON object of field → value.
 *
 * The audio buffer is only ever held in memory for the duration of the request
 * and is never written to disk, S3, or the database.
 */
@Injectable()
export class VoiceNoteService {
  private readonly logger = LoggerService.getInstance(VoiceNoteService.name);

  private readonly openai: OpenAI;
  private readonly transcriptionModel: string;

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly settingsService: SettingsService,
    private readonly llmCompletion: LlmCompletionService,
  ) {
    this.openai = new OpenAI({ apiKey: this.configService.openai.apiKey });
    this.transcriptionModel = this.configService.openai.transcriptionModel;
  }

  /**
   * Orchestrates transcription + extraction. `fieldsRaw` is the JSON string the
   * multipart form carries (multipart text parts always arrive as strings).
   */
  async generateFromAudio(
    audio: Express.Multer.File | undefined,
    fieldsRaw: string | undefined,
    languageHint?: string,
  ): Promise<GenerateNoteFromAudioResponseDto> {
    // Checked before anything else: both downstream calls (Whisper, then
    // Anthropic) are billable, so a request from an org without the feature
    // must not reach them. Mirrors ChatService.createNote's toggle guard —
    // COUNSELOR_ACCESS alone is not enough.
    const enabled = await this.settingsService.getScribeVoiceNoteEnabled();
    if (!enabled) {
      // Carries FEATURE_NOT_ENABLED so the client can say "ask an admin to
      // switch this on" instead of the generic retry copy every other failure
      // on this endpoint produced. The remedy is a toggle, not a retry.
      throw new ForbiddenException({
        message: FAILURE_MESSAGES.VOICE_NOTE_NOT_ENABLED,
        error: 'Forbidden',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: ErrorCode.FEATURE_NOT_ENABLED,
      });
    }

    if (!audio?.buffer?.length) {
      throw new BadRequestException('No audio was provided.');
    }
    const fields = this.parseFields(fieldsRaw);

    const transcript = await this.transcribe(audio, languageHint);
    if (!transcript) {
      // Silent / unintelligible audio. Surfaced to the user as "no speech".
      throw new BadRequestException('NO_SPEECH_DETECTED');
    }

    if (!fields.length) return { transcript, values: [] };

    try {
      return {
        transcript,
        values: await this.extractFields(transcript, fields),
      };
    } catch (error) {
      // Transcription succeeded; only extraction failed. Returning a bare 500
      // here discarded a good transcript — the counsellor had already spoken
      // the note, and the only way back was to record the whole thing again.
      // Fail loudly (this IS a failure, not an empty result) but hand the
      // transcript back with it, so the client can save the dictation to the
      // note and drop the counsellor into the manual form with their words in
      // front of them.
      this.logger.error(
        `[VOICE_NOTE] extraction failed after a good transcript ` +
          `chars=${transcript.length} fields=${fields.length}; ` +
          `returning the transcript so it is not lost`,
        error as any,
      );
      throw new VoiceNoteExtractionFailedException(
        FAILURE_MESSAGES.VOICE_NOTE_EXTRACTION_FAILED,
        ErrorCode.VOICE_NOTE_EXTRACTION_FAILED,
        transcript,
      );
    }
  }

  // ── Step 1: speech-to-text ────────────────────────────────────────────────

  private async transcribe(
    audio: Express.Multer.File,
    languageHint?: string,
  ): Promise<string> {
    const startedAt = Date.now();
    try {
      const mimetype = (audio.mimetype || 'audio/webm').split(';')[0].trim();
      const ext = MIME_EXTENSIONS[mimetype.toLowerCase()] ?? 'webm';
      const file = await toFile(audio.buffer, `dictation.${ext}`, {
        type: mimetype,
      });

      const result = await this.openai.audio.transcriptions.create({
        file,
        model: this.transcriptionModel,
        // Only pass a language when the client sent a hint; otherwise let the
        // model auto-detect (Ally serves many languages).
        ...(languageHint ? { language: languageHint } : {}),
      });

      const text = (result.text ?? '').trim();
      this.logger.info(
        `[VOICE_NOTE] transcribed model=${this.transcriptionModel} ` +
          `bytes=${audio.size} chars=${text.length} elapsedMs=${Date.now() - startedAt}`,
      );
      return text;
    } catch (error) {
      this.logger.error(
        `[VOICE_NOTE] transcription failed model=${this.transcriptionModel} ` +
          `elapsedMs=${Date.now() - startedAt}: ${(error as any)?.message ?? error}`,
        error as any,
      );
      throw new InternalServerErrorException('Failed to transcribe audio.');
    }
  }

  // ── Step 2: LLM field extraction ──────────────────────────────────────────

  private async extractFields(
    transcript: string,
    fields: VoiceNoteFieldSpec[],
  ): Promise<VoiceNoteFieldValueDto[]> {
    const truncated = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
    const [system, user] = await Promise.all([
      this.buildSystemPrompt(),
      this.buildUserPrompt(truncated, fields),
    ]);

    const startedAt = Date.now();
    let raw: string;
    let model: string;
    let stopReason: string | undefined;
    try {
      // No assistant-turn prefill: the Claude 4.6+ family rejects a trailing
      // assistant message with a 400 and it does not translate across
      // providers. The system prompt instructs a bare JSON object instead;
      // parseJsonObject strips any markdown fences the model may add.
      //
      // REASONING tier (gpt-5-mini by default). The FAST model compressed the
      // Session Summary to ~150 words regardless of dictation length and kept
      // only 48% of the facts of a 25-minute dictation; the reasoning tier
      // keeps 93% on the same prompt for ~+8 s and ~+$0.004 a note. The
      // counsellor is still watching a spinner, but a note that drops half of
      // what they said costs them far more than the wait.
      const response = await this.llmCompletion.complete({
        taskId: AI_TASK_ID,
        task: LlmTask.VOICE_NOTE_EXTRACT,
        promptCode: SYSTEM_PROMPT_CODE,
        system,
        prompt: user,
        maxTokens: EXTRACTION_MAX_TOKENS,
      });
      raw = response.text;
      model = response.model;
      stopReason = response.stopReason;
    } catch (error) {
      this.logger.error(
        `[VOICE_NOTE] extraction failed ` +
          `elapsedMs=${Date.now() - startedAt}: ${(error as any)?.message ?? error}`,
        error as any,
      );
      throw new InternalServerErrorException('Failed to generate note fields.');
    }

    const parsed = this.parseJsonObject(raw);
    const {
      values: supported,
      unsupported,
      shape,
    } = this.keepSupported(parsed, truncated);
    const values = this.coerceValues(supported, fields);
    const summary =
      `[VOICE_NOTE] extracted model=${model} stopReason=${stopReason ?? 'unknown'} ` +
      `requested=${fields.length} filled=${values.length} ` +
      `unsupported=${unsupported} shape=${shape} elapsedMs=${Date.now() - startedAt}`;
    if (stopReason === 'max_tokens') {
      // The output was cut by EXTRACTION_MAX_TOKENS. The JSON is then usually
      // unparseable, so this surfaces as an empty or half-filled note that is
      // indistinguishable from "nothing to extract" without this line.
      this.logger.warn(
        `${summary} — output truncated at maxTokens=${EXTRACTION_MAX_TOKENS}; ` +
          `the note is incomplete`,
      );
    } else {
      this.logger.info(summary);
    }
    return values;
  }

  /**
   * The system prompt: its live text in the Skills Store, else the shipped
   * default (src/prompts/scribe_voice_note/field_extraction_system.txt). With
   * neither this throws, and the caller reports an extraction failure (keeping
   * the transcript) instead of calling the model with no instructions.
   */
  private async buildSystemPrompt(): Promise<string> {
    return (
      await loadPromptTemplate(this.promptSharedService, SYSTEM_PROMPT_CODE)
    ).trim();
  }

  /**
   * The user prompt is a superadmin-editable template
   * (Skills Store text, else the shipped
   * src/prompts/scribe_voice_note/field_extraction_user.txt; throws with
   * neither) carrying two
   * runtime variables — `{{transcript}}` (the dictation transcript) and
   * `{{fields}}` (the JSON array of target fields) — which are substituted here.
   */
  private async buildUserPrompt(
    transcript: string,
    fields: VoiceNoteFieldSpec[],
  ): Promise<string> {
    const fieldsJson = JSON.stringify(
      fields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        ...(f.options?.length ? { options: f.options } : {}),
        ...(f.hint ? { hint: f.hint } : {}),
      })),
    );
    const template = (
      await loadPromptTemplate(this.promptSharedService, USER_PROMPT_CODE)
    ).trim();
    return this.renderTemplate(template, { transcript, fields: fieldsJson });
  }

  /**
   * Substitute `{{var}}` / `<var>` placeholders in a prompt template with their
   * runtime values in a single left-to-right pass, so injected content (which
   * may itself contain braces or angle brackets, e.g. the fields JSON) is never
   * re-scanned. Unknown `{{placeholders}}` collapse to empty; unknown `<tokens>`
   * (which occur naturally in prose) are left untouched.
   */
  private renderTemplate(
    template: string,
    variables: Record<string, string>,
  ): string {
    return template.replace(
      /\{\{\s*(\w+)\s*\}\}|<(\w+)>/g,
      (match, braceKey?: string, angleKey?: string) => {
        const key = braceKey ?? angleKey;
        if (key && key in variables) return variables[key] ?? '';
        return braceKey !== undefined ? '' : match;
      },
    );
  }

  // ── Parsing / validation helpers ──────────────────────────────────────────

  private parseFields(fieldsRaw: string | undefined): VoiceNoteFieldSpec[] {
    if (!fieldsRaw) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(fieldsRaw);
    } catch {
      throw new BadRequestException('`fields` must be a valid JSON array.');
    }
    if (!Array.isArray(parsed)) {
      throw new BadRequestException('`fields` must be a JSON array.');
    }

    const seen = new Set<string>();
    const specs: VoiceNoteFieldSpec[] = [];
    for (const item of parsed) {
      if (specs.length >= MAX_FIELDS) break;
      if (!item || typeof item !== 'object') continue;
      const { id, label, type, options, hint } = item as Record<
        string,
        unknown
      >;
      if (typeof id !== 'string' || !id) continue;
      if (typeof label !== 'string' || !label) continue;
      if (typeof type !== 'string' || !VALID_FIELD_TYPES.has(type as any)) {
        continue;
      }
      if (seen.has(id)) continue;
      seen.add(id);

      const spec: VoiceNoteFieldSpec = {
        id,
        label: label.slice(0, MAX_LABEL_LEN),
        type: type as VoiceNoteFieldType,
      };
      if (Array.isArray(options)) {
        const opts = options
          .filter((o): o is string => typeof o === 'string' && o.length > 0)
          .slice(0, MAX_OPTIONS);
        if (opts.length) spec.options = opts;
      }
      if (typeof hint === 'string' && hint) {
        spec.hint = hint.slice(0, MAX_HINT_LEN);
      }
      specs.push(spec);
    }
    return specs;
  }

  private parseJsonObject(raw: string): Record<string, unknown> {
    if (!raw) return {};
    const cleaned = this.stripMarkdownFences(raw).trim();
    try {
      const obj = JSON.parse(cleaned);
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch {
      this.logger.warn(
        '[VOICE_NOTE] could not parse extraction JSON; returning no values',
      );
      return {};
    }
  }

  /**
   * Drops every value the transcript does not back with the model's own quote.
   *
   * The prompt alone did not stop invented values: with 58 fields, gpt-5-mini
   * answered "No" to suicidal plan/action, picked "Congruent" affect and added
   * homework the counsellor never dictated, despite a rule to fill clinical
   * fields only when stated. So each entry carries `evidence` — words copied
   * from the transcript — and an entry whose quote is missing or not found in
   * the transcript is discarded.
   *
   * Accepts both answer shapes while the Skills Store text moves over:
   *   - `evidence`: `{ id: { value, evidence } }` — the gated shape. A plain
   *     value in such a reply has no evidence and is dropped.
   *   - `legacy`: `{ id: value }` with no evidence anywhere — the pre-evidence
   *     prompt is still live, so values pass through unchecked.
   */
  private keepSupported(
    parsed: Record<string, unknown>,
    transcript: string,
  ): {
    values: Record<string, unknown>;
    unsupported: number;
    shape: 'evidence' | 'legacy';
  } {
    const isEntry = (
      v: unknown,
    ): v is { value?: unknown; evidence?: unknown } =>
      !!v && typeof v === 'object' && !Array.isArray(v) && 'value' in v;
    if (!Object.values(parsed).some(isEntry)) {
      return { values: parsed, unsupported: 0, shape: 'legacy' };
    }

    const haystack = ` ${this.normalizeForMatch(transcript)} `;
    const values: Record<string, unknown> = {};
    let unsupported = 0;
    for (const [id, entry] of Object.entries(parsed)) {
      if (isEntry(entry) && this.isQuoted(entry.evidence, haystack)) {
        values[id] = entry.value;
      } else {
        unsupported++;
      }
    }
    return { values, unsupported, shape: 'evidence' };
  }

  /**
   * True when at least one quote is in the transcript and is MIN_EVIDENCE_WORDS
   * long — shorter quotes ("the child", "no") match almost any transcript, so
   * they count for nothing. A quote may skip words with an ellipsis; each piece
   * must then appear on its own.
   *
   * A quote that is not found is ignored rather than sinking the field: a
   * Session Summary cites two dozen passages, and one lightly reworded quote
   * ("The child shared…" for "She shared…") or a two-word heading must not
   * throw the counsellor's whole summary away. An invented value has no real
   * passage behind it, so it still finds nothing.
   */
  private isQuoted(evidence: unknown, haystack: string): boolean {
    const quotes = Array.isArray(evidence) ? evidence : [evidence];
    return quotes.some((quote) => {
      if (typeof quote !== 'string') return false;
      const pieces = quote
        .split(/\.{3}|…/)
        .map((p) => this.normalizeForMatch(p))
        .filter(Boolean);
      const words = pieces.reduce((n, p) => n + p.split(' ').length, 0);
      return (
        words >= MIN_EVIDENCE_WORDS &&
        pieces.every((p) => haystack.includes(` ${p} `))
      );
    });
  }

  /** Lowercase, letters and digits only, single spaces — so punctuation and
   * curly quotes the model tidies do not decide a match. */
  private normalizeForMatch(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  private stripMarkdownFences(text: string): string {
    return text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  }

  /**
   * Validates the raw LLM output against the requested field specs and coerces
   * each value into a clean, human-readable string. Selects are snapped to a
   * valid option (case-insensitive); unmatched selects are dropped.
   */
  private coerceValues(
    parsed: Record<string, unknown>,
    fields: VoiceNoteFieldSpec[],
  ): VoiceNoteFieldValueDto[] {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const out: VoiceNoteFieldValueDto[] = [];

    for (const [id, rawValue] of Object.entries(parsed)) {
      const spec = byId.get(id);
      if (!spec) continue;
      if (rawValue == null) continue;

      const value = this.coerceValue(spec, rawValue);
      if (value != null && value !== '') {
        out.push({ id, value });
      }
    }
    return out;
  }

  private coerceValue(
    spec: VoiceNoteFieldSpec,
    rawValue: unknown,
  ): string | null {
    switch (spec.type) {
      case 'boolean':
        return this.coerceBoolean(rawValue, spec.options);
      case 'select':
        return this.matchOption(String(rawValue), spec.options);
      case 'multiselect': {
        if (!spec.options?.length) return null;
        const matched = this.toValueList(rawValue)
          .map((p) => this.matchOption(p, spec.options))
          .filter((m): m is string => m != null);
        const unique = [...new Set(matched)];
        // JSON-encode the matched labels so option labels that themselves
        // contain commas survive the round trip (the frontend JSON-parses this
        // back into a label list). A comma-joined string would corrupt them.
        return unique.length ? JSON.stringify(unique) : null;
      }
      case 'number': {
        const digits = String(rawValue)
          .replace(/[^\d.-]/g, '')
          .trim();
        return digits || null;
      }
      default: {
        // text, multiline, date
        const str = Array.isArray(rawValue)
          ? rawValue.map(String).join('\n')
          : String(rawValue);
        return str.trim() || null;
      }
    }
  }

  /** Normalize an LLM multiselect value into a list of candidate labels. */
  private toValueList(rawValue: unknown): string[] {
    if (Array.isArray(rawValue)) return rawValue.map(String);
    const str = String(rawValue).trim();
    if (str.startsWith('[')) {
      try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        // fall through to comma split
      }
    }
    return str.split(',');
  }

  /**
   * Map a boolean-ish LLM value ("Yes"/"true"/true/1/…) onto the field's
   * Yes/No option labels. The model often emits a JSON boolean or a synonym
   * rather than the exact option string, so match loosely before falling back
   * to an exact option match.
   */
  private coerceBoolean(rawValue: unknown, options?: string[]): string | null {
    const v = String(rawValue).trim().toLowerCase();
    const truthy = ['yes', 'true', 'y', '1'];
    const falsy = ['no', 'false', 'n', '0'];
    if (truthy.includes(v)) {
      return options?.find((o) => truthy.includes(o.toLowerCase())) ?? null;
    }
    if (falsy.includes(v)) {
      return options?.find((o) => falsy.includes(o.toLowerCase())) ?? null;
    }
    return this.matchOption(String(rawValue), options);
  }

  /** Case-insensitive match of a value against allowed option labels. */
  private matchOption(value: string, options?: string[]): string | null {
    if (!options?.length) return null;
    const needle = value.trim().toLowerCase();
    if (!needle) return null;
    const exact = options.find((o) => o.toLowerCase() === needle);
    return exact ?? null;
  }
}
