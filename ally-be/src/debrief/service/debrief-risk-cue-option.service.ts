import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import {
  DebriefRiskCueOption,
  RiskCueExamples,
  RiskCueHandling,
} from '../entity/debrief-risk-cue-option.entity';

/** The option a roleplay with no choice (or an unreadable one) gets: today's behaviour. */
export const STANDARD_RISK_CUE_KEY = 'standard';

/** What a debrief run applies, snapshotted on the run so a later edit never changes a past debrief. */
export interface ResolvedRiskCue {
  key: string;
  name: string;
  version: number;
  handling: RiskCueHandling;
  wordListRaises: boolean;
  supportLinesOnCue: boolean;
  /** The definition text; null means the pinned `debrief_risk_cue_definition`. */
  wording: string | null;
}

export const STANDARD_RISK_CUE: ResolvedRiskCue = {
  key: STANDARD_RISK_CUE_KEY,
  name: 'Standard',
  version: 1,
  handling: 'alarm',
  wordListRaises: true,
  supportLinesOnCue: true,
  wording: null,
};

export interface RiskCueOptionInput {
  name: string;
  description?: string | null;
  wording: string;
  handling: RiskCueHandling;
  wordListRaises: boolean;
  supportLinesOnCue: boolean;
  examples: RiskCueExamples;
}

export const WORDING_MIN_CHARS = 60;
export const WORDING_MAX_CHARS = 6000;
export const EXAMPLE_MAX_CHARS = 400;
export const EXAMPLES_MAX = 12;

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);

const cleanLines = (xs: unknown): string[] =>
  (Array.isArray(xs) ? xs : [])
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .slice(0, EXAMPLES_MAX)
    .map((x) => x.slice(0, EXAMPLE_MAX_CHARS));

/** The input as stored, or why it can't be (plain words, shown to the creator). */
export function validateRiskCueInput(input: RiskCueOptionInput): {
  value?: RiskCueOptionInput;
  problems: string[];
} {
  const problems: string[] = [];
  const name = String(input?.name ?? '').trim();
  if (name.length < 3 || name.length > 120)
    problems.push('Give the option a name of 3 to 120 characters.');
  const wording = String(input?.wording ?? '').trim();
  if (wording.length < WORDING_MIN_CHARS)
    problems.push(
      `Describe what counts as a risk cue in at least ${WORDING_MIN_CHARS} characters.`,
    );
  if (wording.length > WORDING_MAX_CHARS)
    problems.push(`Keep the wording under ${WORDING_MAX_CHARS} characters.`);
  if (input?.handling !== 'alarm' && input?.handling !== 'assessed')
    problems.push('Choose how a risk cue is handled: alarm or assessed.');
  const cues = cleanLines(input?.examples?.cues);
  const nonCues = cleanLines(input?.examples?.nonCues);
  if (!cues.length)
    problems.push('Add at least one example that is a risk cue.');
  if (!nonCues.length)
    problems.push('Add at least one example that is not a risk cue.');
  if (problems.length) return { problems };
  return {
    problems,
    value: {
      name,
      description: input.description?.trim() || null,
      wording,
      handling: input.handling,
      wordListRaises: input.wordListRaises !== false,
      supportLinesOnCue: input.supportLinesOnCue !== false,
      examples: { cues, nonCues },
    },
  };
}

/**
 * Risk-cue options (spec DEBRIEF_ACROSS_ROLEPLAYS §5): what a roleplay's Debrief counts as a risk
 * cue and how it handles one. A creator writes an option; a clinical advisor approves it once its
 * own example test passes; an approved option is selectable by every roleplay. An agent may draft
 * the wording but never decides it. Standard and Part of the practice are seeded.
 */
@Injectable()
export class DebriefRiskCueOptionService {
  private readonly logger = LoggerService.getInstance(
    DebriefRiskCueOptionService.name,
  );

  constructor(
    @InjectRepository(DebriefRiskCueOption)
    private readonly options: Repository<DebriefRiskCueOption>,
  ) {}

  /** What a run applies for a roleplay's choice; unreadable or unknown reads as Standard. */
  async resolve(key?: string | null): Promise<ResolvedRiskCue> {
    const wanted = String(key ?? '').trim() || STANDARD_RISK_CUE_KEY;
    try {
      const row = await this.options.findOne({ where: { key: wanted } });
      // A retired option keeps working for roleplays that already use it; a draft never does.
      if (row && (row.status === 'approved' || row.status === 'retired')) {
        return toResolved(row);
      }
      if (wanted !== STANDARD_RISK_CUE_KEY) {
        this.logger.warn(
          `[debrief] risk-cue option "${wanted}" is not approved; using Standard`,
        );
      }
      const std = await this.options.findOne({
        where: { key: STANDARD_RISK_CUE_KEY },
      });
      return std ? toResolved(std) : STANDARD_RISK_CUE;
    } catch (e) {
      this.logger.warn(
        `[debrief] risk-cue options unreadable, using Standard: ${(e as Error).message}`,
      );
      return STANDARD_RISK_CUE;
    }
  }

  /**
   * What the Studio dropdown lists: every approved option, plus the caller's own drafts and
   * submissions (their own work in progress), Standard first.
   */
  async list(userId: number | null): Promise<DebriefRiskCueOption[]> {
    const rows = await this.options.find({ order: { createdAt: 'ASC' } });
    const mine = (r: DebriefRiskCueOption) =>
      userId != null && r.createdBy === userId;
    return rows
      .filter(
        (r) =>
          r.status === 'approved' ||
          (mine(r) &&
            (r.status === 'draft' || r.status === 'awaiting_approval')),
      )
      .sort(
        (a, b) =>
          Number(b.key === STANDARD_RISK_CUE_KEY) -
          Number(a.key === STANDARD_RISK_CUE_KEY),
      );
  }

  /** Everything a clinical advisor reviews (awaiting approval first) plus what is live. */
  async listForReview(): Promise<DebriefRiskCueOption[]> {
    const rows = await this.options.find({ order: { updatedAt: 'DESC' } });
    const rank = (r: DebriefRiskCueOption) =>
      r.status === 'awaiting_approval' ? 0 : r.status === 'draft' ? 2 : 1;
    return rows.sort((a, b) => rank(a) - rank(b));
  }

  async awaitingCount(): Promise<number> {
    return this.options.count({ where: { status: 'awaiting_approval' } });
  }

  async get(id: string): Promise<DebriefRiskCueOption> {
    const row = await this.options.findOne({ where: { id } });
    if (!row) throw new NotFoundException('No such risk-cue option');
    return row;
  }

  async create(
    input: RiskCueOptionInput,
    userId: number,
  ): Promise<DebriefRiskCueOption> {
    const { value, problems } = validateRiskCueInput(input);
    if (!value)
      throw new BadRequestException({ message: problems.join(' '), problems });
    let key = slug(value.name) || 'option';
    for (let n = 2; await this.options.exist({ where: { key } }); n++) {
      key = `${slug(value.name).slice(0, 44)}_${n}`;
    }
    return this.options.save(
      this.options.create({
        key,
        name: value.name,
        description: value.description,
        wording: value.wording,
        handling: value.handling,
        wordListRaises: value.wordListRaises,
        supportLinesOnCue: value.supportLinesOnCue,
        examples: value.examples,
        status: 'draft',
        createdBy: userId,
      }),
    );
  }

  /** A draft is edited by its creator; an approved option is never edited (create a new one). */
  async update(
    id: string,
    input: RiskCueOptionInput,
    userId: number,
  ): Promise<DebriefRiskCueOption> {
    const row = await this.get(id);
    if (row.status !== 'draft') {
      throw new ConflictException(
        row.status === 'awaiting_approval'
          ? 'It is waiting for a clinical advisor; ask them to turn it down to change it.'
          : 'An approved option is not edited: create a new one and retire this one.',
      );
    }
    if (row.createdBy !== userId)
      throw new ForbiddenException('Only its creator can edit a draft.');
    const { value, problems } = validateRiskCueInput(input);
    if (!value)
      throw new BadRequestException({ message: problems.join(' '), problems });
    Object.assign(row, {
      name: value.name,
      description: value.description,
      wording: value.wording,
      handling: value.handling,
      wordListRaises: value.wordListRaises,
      supportLinesOnCue: value.supportLinesOnCue,
      examples: value.examples,
      // Any edit voids the last test.
      testResult: null,
      version: row.version + 1,
    });
    return this.options.save(row);
  }

  async submit(id: string, userId: number): Promise<DebriefRiskCueOption> {
    const row = await this.get(id);
    if (row.status !== 'draft')
      throw new ConflictException('Only a draft can be submitted.');
    if (row.createdBy !== userId)
      throw new ForbiddenException('Only its creator can submit it.');
    const { problems } = validateRiskCueInput({
      name: row.name,
      wording: row.wording ?? '',
      handling: row.handling,
      wordListRaises: row.wordListRaises,
      supportLinesOnCue: row.supportLinesOnCue,
      examples: row.examples,
    });
    if (problems.length)
      throw new BadRequestException({ message: problems.join(' '), problems });
    row.status = 'awaiting_approval';
    row.reviewNote = null;
    return this.options.save(row);
  }

  /** Records a safety-test run (by the test service) against the current version. */
  async recordTest(
    id: string,
    result: Record<string, any>,
  ): Promise<DebriefRiskCueOption> {
    const row = await this.get(id);
    row.testResult = {
      ...result,
      version: row.version,
      at: new Date().toISOString(),
    };
    return this.options.save(row);
  }

  /** A clinical advisor (or the owner) approves: only once its test passed on this version. */
  async approve(
    id: string,
    approverId: number,
    note?: string,
  ): Promise<DebriefRiskCueOption> {
    const row = await this.get(id);
    if (row.status !== 'awaiting_approval')
      throw new ConflictException(
        'Only an option awaiting approval can be approved.',
      );
    const t = row.testResult as { passed?: boolean; version?: number } | null;
    if (!t || t.passed !== true || t.version !== row.version) {
      throw new ConflictException(
        'Run its test first: it must pass on this version before it can be approved.',
      );
    }
    row.status = 'approved';
    row.approvedBy = approverId;
    row.approvedAt = new Date();
    row.reviewNote = note?.trim() || null;
    row.history = [
      ...(row.history ?? []),
      {
        version: row.version,
        name: row.name,
        wording: row.wording ?? null,
        handling: row.handling,
        wordListRaises: row.wordListRaises,
        supportLinesOnCue: row.supportLinesOnCue,
        examples: row.examples,
        approvedBy: approverId,
        approvedAt: row.approvedAt.toISOString(),
      },
    ];
    return this.options.save(row);
  }

  /** Back to its creator, with the reason. */
  async reject(id: string, reason: string): Promise<DebriefRiskCueOption> {
    const row = await this.get(id);
    if (row.status !== 'awaiting_approval')
      throw new ConflictException(
        'Only an option awaiting approval can be turned down.',
      );
    const why = String(reason ?? '').trim();
    if (!why) throw new BadRequestException('Say why it is turned down.');
    row.status = 'draft';
    row.reviewNote = why;
    return this.options.save(row);
  }

  /** No new roleplay may pick it; roleplays already using it keep it. Standard cannot be retired. */
  async retire(id: string): Promise<DebriefRiskCueOption> {
    const row = await this.get(id);
    if (row.key === STANDARD_RISK_CUE_KEY)
      throw new ConflictException(
        'Standard cannot be retired: it is every roleplay’s default.',
      );
    if (row.status !== 'approved')
      throw new ConflictException('Only an approved option can be retired.');
    row.status = 'retired';
    return this.options.save(row);
  }
}

export function toResolved(row: DebriefRiskCueOption): ResolvedRiskCue {
  return {
    key: row.key,
    name: row.name,
    version: row.version,
    handling: row.handling === 'assessed' ? 'assessed' : 'alarm',
    wordListRaises: row.wordListRaises !== false,
    supportLinesOnCue: row.supportLinesOnCue !== false,
    wording: row.wording?.trim() ? row.wording : null,
  };
}
