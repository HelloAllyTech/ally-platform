import { BadGatewayException, Injectable } from '@nestjs/common';
import axios from 'axios';
import { AppConfigService } from '../../config/config.service';
import { DebriefRiskCueOption } from '../entity/debrief-risk-cue-option.entity';
import { DebriefRiskCueOptionService } from './debrief-risk-cue-option.service';
import { DebriefContextRepository } from './debrief-context.repository';

/** The test runs the Safety reader this many times; every run must pass (as for the seeded set). */
export const RISK_CUE_TEST_REPS = 3;

/** `POST /api/v1/debrief/risk-cue-tests` in ally-ai. */
export interface RiskCueTestResult {
  passed: boolean;
  reps: Array<{
    rep: number;
    /** Cue examples the Safety reader did not flag as a risk cue. */
    missed: string[];
    /** Non-cue examples it flagged as a clear risk cue. */
    false_clear: string[];
  }>;
  cue_examples: number;
  non_cue_examples: number;
  model?: string | null;
}

/**
 * Runs an option's own examples through the Safety reader with the option's wording (spec
 * DEBRIEF_ACROSS_ROLEPLAYS §5): every example cue must be found and no example non-cue flagged
 * clear, on every run. The result is recorded against the option's current version; an edit voids
 * it. Costs a few cents (a short synthetic session per example, three runs).
 */
@Injectable()
export class DebriefRiskCueTestService {
  constructor(
    private readonly config: AppConfigService,
    private readonly options: DebriefRiskCueOptionService,
    private readonly context: DebriefContextRepository,
  ) {}

  async run(option: DebriefRiskCueOption): Promise<DebriefRiskCueOption> {
    // An option with no wording of its own reads the pinned definition (the seeded two).
    const wording =
      option.wording?.trim() ||
      (await this.context.promptText('debrief_risk_cue_definition', null));
    const { apiUrl, outboundApiKey } = this.config.ai;
    let data: RiskCueTestResult;
    try {
      const res = await axios.post(
        `${apiUrl}/api/v1/debrief/risk-cue-tests`,
        {
          risk_cue_definition: wording,
          word_list_raises: option.wordListRaises,
          cue_examples: option.examples?.cues ?? [],
          non_cue_examples: option.examples?.nonCues ?? [],
          reps: RISK_CUE_TEST_REPS,
        },
        { headers: { 'x-api-key': outboundApiKey }, timeout: 240_000 },
      );
      data = res.data as RiskCueTestResult;
    } catch (e) {
      throw new BadGatewayException(
        `The safety test could not run: ${(e as Error).message}`,
      );
    }
    return this.options.recordTest(option.id, {
      passed: data.passed === true,
      reps: data.reps,
      cueExamples: data.cue_examples,
      nonCueExamples: data.non_cue_examples,
      model: data.model ?? null,
    });
  }
}
