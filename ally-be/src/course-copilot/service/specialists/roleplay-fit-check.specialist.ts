import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  parseFirstJsonObject,
  stripMarkdownFences,
} from 'src/learn/util/autofill-shared.util';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  COURSE_COPILOT_ROLEPLAY_FIT_CHECK,
  renderPrompt,
} from 'src/prompt/contracts';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { COURSE_COPILOT_AI_TASKS } from '../../constants/course-copilot.constants';
import {
  RoleplayCasting,
  RoleplayFitCheck,
  StructuredRoleplayBrief,
} from '../../type/roleplay-brief.type';
import {
  CharacterProfile,
  CourseCopilotLibraryService,
} from '../course-copilot-library.service';

/** Room for a reasoning model's thinking plus a short JSON verdict. */
const FIT_CHECK_MAX_TOKENS = 2048;
/** Library characters offered as alternatives. */
const MAX_CANDIDATES = 6;
/** Alternatives kept on the verdict. */
const MAX_ALTERNATIVES = 2;
/** Caps one character's profile in the prompt. */
const MAX_PROFILE_CHARS = 1500;

export interface RoleplayCastingScope {
  sessionId: string;
  tenantId: string | null;
  competencyIds: string[];
  usageMetadata: Record<string, any>;
}

/**
 * The roleplay agent's first step: can the library character chosen for a
 * slot carry it? A character profile describes who a person is, so a
 * withdrawn, low-disclosure character cannot train eliciting a guarded
 * concern however the roleplay is written.
 *
 * When the character does not fit, casting swaps in the best-fitting library
 * alternative and records the swap, which the trainer sees as an assumption
 * to check — rather than stopping the build to ask. A generated persona is
 * written to fit its brief, so it is never checked.
 *
 * Casting never fails a build: any error keeps the trainer's character.
 */
@Injectable()
export class RoleplayFitCheckSpecialist {
  private readonly logger = LoggerService.getInstance(
    RoleplayFitCheckSpecialist.name,
  );

  constructor(
    private readonly promptSharedService: PromptSharedService,
    private readonly llmCompletion: LlmCompletionService,
    private readonly library: CourseCopilotLibraryService,
  ) {}

  async cast(
    brief: StructuredRoleplayBrief,
    scope: RoleplayCastingScope,
  ): Promise<RoleplayCasting> {
    const characterId = brief.character.characterId;
    if (!characterId) return {};

    try {
      const [chosen] = await this.library.characterProfiles([characterId]);
      if (!chosen) return { characterId };

      const candidates = await this.candidates(brief, chosen.id, scope);
      const fitCheck = await this.check(brief, chosen, candidates, scope);
      if (fitCheck.fits || !fitCheck.alternatives.length) {
        return { characterId, fitCheck };
      }

      const to = fitCheck.alternatives[0];
      this.logger.info(
        `[COURSE_COPILOT] fit check swapped character ${chosen.id} for ${to.characterId} (session ${scope.sessionId})`,
      );
      return {
        characterId: to.characterId,
        fitCheck,
        swapped: {
          fromCharacterId: chosen.id,
          fromName: chosen.name,
          toCharacterId: to.characterId,
          toName: to.name,
          reason: fitCheck.reason,
        },
      };
    } catch (error) {
      this.logger.warn(
        `[COURSE_COPILOT] fit check skipped for character ${characterId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { characterId };
    }
  }

  /**
   * Library characters that might fit better, voiced ones first (a roleplay
   * needs a voice per language). A failed search means no alternatives, not
   * a failed check.
   */
  private async candidates(
    brief: StructuredRoleplayBrief,
    chosenId: string,
    scope: RoleplayCastingScope,
  ): Promise<CharacterProfile[]> {
    const query = [
      brief.character.personaBrief,
      brief.setting,
      ...brief.opportunities,
    ]
      .filter(Boolean)
      .join('; ');
    let ids: string[] = [];
    try {
      const { hits } = await this.library.search(
        'character',
        query,
        scope.competencyIds,
        MAX_CANDIDATES + 1,
        { sessionId: scope.sessionId, tenantId: scope.tenantId },
      );
      ids = hits.map((hit) => String(hit.id)).filter((id) => id !== chosenId);
    } catch (error) {
      this.logger.warn(
        `[COURSE_COPILOT] character search failed for the fit check: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
    const profiles = await this.library.characterProfiles(
      ids.slice(0, MAX_CANDIDATES),
    );
    return profiles.sort((a, b) => Number(b.hasVoices) - Number(a.hasVoices));
  }

  private async check(
    brief: StructuredRoleplayBrief,
    chosen: CharacterProfile,
    candidates: CharacterProfile[],
    scope: RoleplayCastingScope,
  ): Promise<RoleplayFitCheck> {
    const template =
      (await this.promptSharedService.getPromptByCode(
        COURSE_COPILOT_ROLEPLAY_FIT_CHECK.code,
      )) ?? '';
    if (!template) {
      throw new Error(
        `Prompt template not found: ${COURSE_COPILOT_ROLEPLAY_FIT_CHECK.code}`,
      );
    }
    const response = await this.llmCompletion.complete({
      taskId: COURSE_COPILOT_AI_TASKS.ROLEPLAY_FIT_CHECK,
      task: LlmTask.COURSE_COPILOT_ROLEPLAY_FIT_CHECK,
      promptCode: COURSE_COPILOT_ROLEPLAY_FIT_CHECK.code,
      prompt: renderPrompt(COURSE_COPILOT_ROLEPLAY_FIT_CHECK, template, {
        brief: describeBrief(brief),
        character: describeCharacter(chosen),
        candidates: candidates.length
          ? candidates.map(describeCharacter).join('\n\n')
          : '(none)',
      }),
      maxTokens: FIT_CHECK_MAX_TOKENS,
      jsonMode: true,
      usageMetadata: scope.usageMetadata,
    });
    return parseFitCheck(response.text, chosen.id, candidates);
  }
}

const bullets = (items: string[]): string =>
  items.length ? items.map((i) => `  - ${i}`).join('\n') : '  - (none)';

export const describeBrief = (brief: StructuredRoleplayBrief): string =>
  [
    `Mode: ${brief.mode}`,
    `Difficulty: ${brief.condition.difficulty}${
      brief.condition.taskClass ? ` (${brief.condition.taskClass})` : ''
    }`,
    brief.setting ? `Setting: ${brief.setting}` : null,
    brief.learnerGoal ? `The learner's goal: ${brief.learnerGoal}` : null,
    `Moments the character must create:\n${bullets(brief.opportunities)}`,
    `Behaviours the learner practises:\n${bullets(brief.behaviours.helpful)}`,
    `Habits the character invites:\n${bullets(brief.behaviours.unhelpful)}`,
  ]
    .filter(Boolean)
    .join('\n');

const describeCharacter = (character: CharacterProfile): string =>
  [
    `id: ${character.id}`,
    `name: ${character.name}${character.summary ? ` (${character.summary})` : ''}`,
    `profile: ${
      character.profileText
        ? character.profileText.slice(0, MAX_PROFILE_CHARS)
        : '(no saved profile)'
    }`,
  ].join('\n');

/**
 * The model's verdict, held to what it was offered: an alternative it made up
 * is dropped, and an unreadable answer counts as a fit (keep the trainer's
 * choice) rather than a swap.
 */
export const parseFitCheck = (
  raw: string,
  characterId: string,
  candidates: CharacterProfile[],
): RoleplayFitCheck => {
  const parsed = parseFirstJsonObject(stripMarkdownFences(raw ?? '')) ?? {};
  const fits = parsed.fits !== false;
  const reason =
    typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim()
      : fits
        ? 'The character fits this roleplay.'
        : 'The character does not fit this roleplay.';
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const alternatives = fits
    ? []
    : [
        ...new Set<string>(
          (Array.isArray(parsed.alternativeIds) ? parsed.alternativeIds : [])
            .map(String)
            .filter((id: string) => byId.has(id) && id !== characterId),
        ),
      ]
        .slice(0, MAX_ALTERNATIVES)
        .map((id) => ({ characterId: id, name: byId.get(id)!.name }));
  return { characterId, fits, reason, alternatives };
};
