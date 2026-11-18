import { plainToInstance, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  registerDecorator,
  ValidateNested,
  validateSync,
  ValidationError,
  ValidationOptions,
} from 'class-validator';
import {
  PmCardKind,
  PmCardSize,
  PmQuestionScope,
  PmRepo,
  PmRiskLevel,
} from '../enum/pm-agent.enum';
import { metricRefProblems, PmMetricRef } from '../impact/metric-catalog';
import { ROADMAP_FILEABLE_EFFORTS } from 'src/product-roadmap/constants/product-roadmap.constants';

/**
 * The card payload contract (docs/pm-agent.md "Card payload", schemaVersion 1).
 *
 * The length limits are what keep a card a 10-second read, and they are enforced here —
 * by the Persister's gate — not just asked for in the prompt. An LLM's output that fails
 * this is discarded, never persisted.
 */
export const PM_CARD_LIMITS = {
  TITLE_WORDS: 12,
  WHY_WORDS: 25,
  CHANGE_BULLETS: 3,
  CHANGE_WORDS: 15,
  OPTION_WORDS: 8,
  OPTIONS_MIN: 2,
  OPTIONS_MAX: 4,
  TEXT_MAX: 2000,
  LINE_MAX: 300,
  LIST_MAX: 20,
  /** The roadmap's own description cap (ROADMAP_LIMITS.DESCRIPTION_MAX). */
  OPPORTUNITY_MAX: 1000,
  OPPORTUNITY_MIN: 80,
  GOAL_MAX: 120,
} as const;

const wordCount = (value: string) =>
  value.trim().split(/\s+/).filter(Boolean).length;

/** At most `max` whitespace-separated words. */
export function MaxWords(max: number, options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'maxWords',
      target: object.constructor,
      propertyName,
      constraints: [max],
      options: {
        message: `${propertyName} must be at most ${max} words`,
        ...options,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && wordCount(value) <= max,
      },
    });
}

/** The "why" headline must cite one number. */
export function ContainsNumber(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'containsNumber',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must cite a number`,
        ...options,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && /\d/.test(value),
      },
    });
}

/**
 * A valid `metricRef` (impact checks): source in the measurable-metric catalog, params
 * shape-checked against the entry, betterWhen up|down, unit (when sent) the entry's own.
 */
export function IsPmMetricRef(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isPmMetricRef',
      target: object.constructor,
      propertyName,
      options: {
        message: (args) =>
          metricRefProblems(args.value).join('; ') ||
          `${propertyName} is invalid`,
        ...options,
      },
      validator: {
        validate: (value: unknown) => metricRefProblems(value).length === 0,
      },
    });
}

export class PmCardPlanDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PM_CARD_LIMITS.LIST_MAX)
  @IsString({ each: true })
  @MaxLength(PM_CARD_LIMITS.LINE_MAX, { each: true })
  steps!: string[];

  @IsArray()
  @ArrayMaxSize(PM_CARD_LIMITS.LIST_MAX)
  @IsString({ each: true })
  @MaxLength(PM_CARD_LIMITS.LINE_MAX, { each: true })
  files!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PM_CARD_LIMITS.LIST_MAX)
  @IsString({ each: true })
  @MaxLength(PM_CARD_LIMITS.LINE_MAX, { each: true })
  acceptanceCriteria!: string[];

  @IsArray()
  @ArrayMaxSize(PM_CARD_LIMITS.LIST_MAX)
  @IsString({ each: true })
  @MaxLength(PM_CARD_LIMITS.LINE_MAX, { each: true })
  testPlan!: string[];

  @IsArray()
  @ArrayMaxSize(PM_CARD_LIMITS.LIST_MAX)
  @IsString({ each: true })
  @MaxLength(PM_CARD_LIMITS.LINE_MAX, { each: true })
  defaultsChosen!: string[];
}

export class PmImpactMetricDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsIn(['up', 'down'])
  direction!: 'up' | 'down';
}

/**
 * The roadmap entry an accepted recommendation is filed as (docs/pm-agent.md "Filing to the
 * roadmap"). Written by the lane in the roadmap's own shape, so what the admin accepts is
 * exactly what lands on the board: `description` is the opportunity text, `productGoal` one
 * of the roadmap's product goal NAMES (checked against the live list by gate layer 1), and
 * `effort` the roadmap's shirt size. The critic grades `description` against the roadmap's
 * readiness checklist (ROADMAP_READINESS_CRITERIA) before the card is ever shown.
 */
export class PmOpportunityDraftDto {
  @IsString()
  @MinLength(PM_CARD_LIMITS.OPPORTUNITY_MIN)
  @MaxLength(PM_CARD_LIMITS.OPPORTUNITY_MAX)
  description!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(PM_CARD_LIMITS.GOAL_MAX)
  productGoal!: string;

  @IsIn([...ROADMAP_FILEABLE_EFFORTS])
  effort!: (typeof ROADMAP_FILEABLE_EFFORTS)[number];
}

export class PmRecommendationPayloadDto {
  @Equals(1)
  schemaVersion!: 1;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @MaxWords(PM_CARD_LIMITS.TITLE_WORDS)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(PM_CARD_LIMITS.LINE_MAX)
  @MaxWords(PM_CARD_LIMITS.WHY_WORDS)
  @ContainsNumber()
  whyHeadline!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PM_CARD_LIMITS.CHANGE_BULLETS)
  @IsString({ each: true })
  @MaxWords(PM_CARD_LIMITS.CHANGE_WORDS, { each: true })
  change!: string[];

  @IsString()
  @MinLength(1)
  @MaxLength(PM_CARD_LIMITS.TEXT_MAX)
  problem!: string;

  @ValidateNested()
  @Type(() => PmCardPlanDto)
  plan!: PmCardPlanDto;

  @IsEnum(PmCardSize)
  size!: PmCardSize;

  @IsEnum(PmRiskLevel)
  risk!: PmRiskLevel;

  @IsString()
  @MaxLength(PM_CARD_LIMITS.LINE_MAX)
  riskWhy!: string;

  @IsString()
  @MaxLength(PM_CARD_LIMITS.LINE_MAX)
  rollbackNote!: string;

  @ValidateNested()
  @Type(() => PmImpactMetricDto)
  impactMetric!: PmImpactMetricDto;

  /**
   * Optional, additive (v1.1): the catalog metric the impact checks read. Absent = the card
   * is shown as "impact not measurable".
   */
  @IsOptional()
  @IsPmMetricRef()
  metricRef?: PmMetricRef;

  @IsArray()
  @ArrayMaxSize(PM_CARD_LIMITS.LIST_MAX)
  @IsString({ each: true })
  @MaxLength(PM_CARD_LIMITS.LINE_MAX, { each: true })
  alternativesDropped!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(PmRepo, { each: true })
  repos!: PmRepo[];

  /**
   * Required since 2026-11-17: what Accept files to the roadmap. IsObject because
   * ValidateNested alone lets a missing value through.
   */
  @IsObject()
  @ValidateNested()
  @Type(() => PmOpportunityDraftDto)
  opportunity!: PmOpportunityDraftDto;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PM_CARD_LIMITS.LIST_MAX)
  @IsUUID('all', { each: true })
  evidenceIds!: string[];
}

export class PmQuestionOptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @MaxWords(PM_CARD_LIMITS.OPTION_WORDS)
  label!: string;

  @IsString()
  @MaxLength(PM_CARD_LIMITS.LINE_MAX)
  consequence!: string;

  @IsOptional()
  @IsBoolean()
  suggested?: boolean;
}

export class PmQuestionPayloadDto {
  @Equals(1)
  schemaVersion!: 1;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(PM_CARD_LIMITS.LINE_MAX)
  askedBecause!: string;

  @IsString()
  @MaxLength(PM_CARD_LIMITS.LINE_MAX)
  usedFor!: string;

  @IsArray()
  @ArrayMinSize(PM_CARD_LIMITS.OPTIONS_MIN)
  @ArrayMaxSize(PM_CARD_LIMITS.OPTIONS_MAX)
  @ValidateNested({ each: true })
  @Type(() => PmQuestionOptionDto)
  options!: PmQuestionOptionDto[];

  @IsEnum(PmQuestionScope)
  scope!: PmQuestionScope;

  /** Stable key for the 14-day skip suppression and the answer's memory fact. */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  questionKey?: string;
}

const flatten = (errors: ValidationError[], prefix = ''): string[] =>
  errors.flatMap((error) => {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    return [
      ...Object.values(error.constraints ?? {}).map(
        (message) => `${path}: ${message}`,
      ),
      ...flatten(error.children ?? [], path),
    ];
  });

/**
 * Validate a card payload for its kind. Returns the list of problems (empty = valid).
 * The Persister (pipeline) calls this; unknown keys are rejected so a model cannot
 * smuggle fields the UI or the PRD compiler would then trust.
 */
export function validateCardPayload(
  kind: PmCardKind,
  payload: unknown,
): string[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['payload: must be an object'];
  }
  const instance: object =
    kind === PmCardKind.RECOMMENDATION
      ? plainToInstance(PmRecommendationPayloadDto, payload)
      : plainToInstance(PmQuestionPayloadDto, payload);
  return flatten(
    validateSync(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
}
