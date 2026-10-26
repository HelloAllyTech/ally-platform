import { Injectable } from '@nestjs/common';
import { Languages } from 'src/language/entity/languages.entity';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { PromptSharedService } from './prompt-shared.service';
import { hashPromptBody } from '../util/prompt-contract.util';

/**
 * Helpers that feed the translation trigger (Phase 2) and the runtime freshness
 * gate (Phase 3):
 *
 * - `hashEffectiveBody` / `hashBody` — the `sourceHash` of a prompt's *effective*
 *   English body (override-on version body vs. file — resolved via
 *   `getPromptByCode`). Runtime serves a translation only while its stored
 *   `sourceHash` still equals this, which is what keeps translations aligned to
 *   the current English source across both storage paths.
 * - `getEligibleTargetLanguages` — the target languages to translate into.
 */
@Injectable()
export class PromptTranslationTargetsService {
  constructor(
    private readonly promptSharedService: PromptSharedService,
    private readonly sharedLanguageService: SharedLanguageService,
  ) {}

  /** SHA-256 hex (64 chars, matching `prompt_translations.sourceHash`). */
  hashBody(body: string): string {
    // One hash for writing and looking up translations: delegating keeps the
    // store-time and serve-time hashes byte-identical (see hashPromptBody).
    return hashPromptBody(body);
  }

  /**
   * Hash the current effective English body of a prompt, or null when the
   * prompt has no resolvable body.
   */
  async hashEffectiveBody(promptCode: string): Promise<string | null> {
    const body = await this.promptSharedService.getPromptByCode(promptCode);
    if (body === null || body === undefined) return null;
    return this.hashBody(body);
  }

  getEligibleTargetLanguages(): Promise<Languages[]> {
    return this.sharedLanguageService.getEligibleAppLanguages();
  }
}
