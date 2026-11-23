import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BehaviorInstructionDto } from '../behavior-instruction.dto';
import { BehaviorInstructionCategory } from '../../enum/behavior-instruction.enum';
import { resolveBehaviorInstructionScore } from '../../util/scenario-behavior-instructions.util';

const errorsFor = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(BehaviorInstructionDto, body);
  const errors = await validate(dto);
  return errors.filter((e) => e.property === 'score');
};

const DO = BehaviorInstructionCategory.SHOULD_DO;
const DONT = BehaviorInstructionCategory.SHOULD_NOT_DO;

describe('BehaviorInstructionDto.score', () => {
  it.each([
    [DO, 50],
    [DO, 100],
    [DO, 0],
    [DONT, -75],
    [DONT, -100],
    [DONT, 0],
  ])('accepts %s score %p', async (category, score) => {
    expect(await errorsFor({ category, score })).toHaveLength(0);
  });

  it('treats an omitted or null score as the category default', async () => {
    expect(await errorsFor({ category: DO })).toHaveLength(0);
    expect(await errorsFor({ category: DONT, score: null })).toHaveLength(0);
  });

  it.each([
    [DO, 101],
    [DONT, -101],
  ])('rejects out-of-range %s score %p', async (category, score) => {
    expect(await errorsFor({ category, score })).not.toHaveLength(0);
  });

  it.each([50.5, -0.5, '10', NaN])(
    'rejects non-integer score %p',
    async (score) => {
      expect(await errorsFor({ category: DO, score })).not.toHaveLength(0);
    },
  );

  it('rejects a negative score on a should-do behaviour', async () => {
    expect(await errorsFor({ category: DO, score: -10 })).not.toHaveLength(0);
  });

  it('rejects a positive score on a should-not-do behaviour', async () => {
    expect(await errorsFor({ category: DONT, score: 10 })).not.toHaveLength(0);
  });
});

describe('resolveBehaviorInstructionScore', () => {
  it('uses the authored score, including 0', () => {
    expect(resolveBehaviorInstructionScore(DO, 75)).toBe(75);
    expect(resolveBehaviorInstructionScore(DONT, -75)).toBe(-75);
    expect(resolveBehaviorInstructionScore(DO, 0)).toBe(0);
  });

  it('falls back to +10 / -10 when no score was authored', () => {
    expect(resolveBehaviorInstructionScore(DO, null)).toBe(10);
    expect(resolveBehaviorInstructionScore(DO, undefined)).toBe(10);
    expect(resolveBehaviorInstructionScore(DONT, null)).toBe(-10);
  });
});
