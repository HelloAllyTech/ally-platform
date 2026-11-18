import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';
import { supportedStateInstructionStateIds } from '../constants/scenario-state-instructions.constants';
import {
  BEHAVIOR_INSTRUCTION_MAX_SCORE,
  BEHAVIOR_INSTRUCTION_MIN_SCORE,
} from '../constants/scenario-behavior-instuctions.constants';

/**
 * A "should do" behaviour may not take points away and a "should not do"
 * behaviour may not award them. Zero is allowed on either (noticed, not scored).
 * Runs on the score property but reads the sibling `category`.
 */
@ValidatorConstraint({ name: 'behaviorScoreMatchesCategory', async: false })
export class BehaviorScoreMatchesCategoryConstraint implements ValidatorConstraintInterface {
  validate(score: unknown, args: ValidationArguments): boolean {
    if (typeof score !== 'number') return true; // null/undefined: category default
    const { category } = args.object as {
      category?: BehaviorInstructionCategory;
    };
    if (category === BehaviorInstructionCategory.SHOULD_DO) return score >= 0;
    if (category === BehaviorInstructionCategory.SHOULD_NOT_DO)
      return score <= 0;
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const { category } = args.object as {
      category?: BehaviorInstructionCategory;
    };
    return category === BehaviorInstructionCategory.SHOULD_DO
      ? 'score must be 0 or positive for a "should do" behaviour'
      : 'score must be 0 or negative for a "should not do" behaviour';
  }
}

class BehaviorStateInstructionDto {
  @ApiProperty({
    description: 'State ID (simulation phase)',
    enum: supportedStateInstructionStateIds,
    example: '1',
  })
  @IsNotEmpty()
  @IsString()
  @IsIn(supportedStateInstructionStateIds)
  stateId!: string;

  @ApiProperty({
    description: 'State Instruction',
    example: 'Express mild doubt about if talking is helping',
  })
  @IsOptional()
  @IsString()
  instruction?: string;
}

export class BehaviorInstructionDto {
  @ApiProperty({
    description: 'ID of the behavior instruction (required only for update)',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({
    description: 'Category of the behavior instruction',
    enum: BehaviorInstructionCategory,
    example: BehaviorInstructionCategory.SHOULD_DO,
  })
  @IsEnum(BehaviorInstructionCategory)
  @IsNotEmpty()
  category!: BehaviorInstructionCategory;

  @ApiProperty({
    description:
      'Points added to the session score each time this behaviour is detected: an integer from -100 to 100, positive for SHOULD_DO and negative for SHOULD_NOT_DO. Omit or send null for the category default (+10 / -10).',
    required: false,
    nullable: true,
    minimum: BEHAVIOR_INSTRUCTION_MIN_SCORE,
    maximum: BEHAVIOR_INSTRUCTION_MAX_SCORE,
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(BEHAVIOR_INSTRUCTION_MIN_SCORE)
  @Max(BEHAVIOR_INSTRUCTION_MAX_SCORE)
  @Validate(BehaviorScoreMatchesCategoryConstraint)
  score?: number | null;

  @ApiProperty({
    description: 'Array of behavior IDs',
    example: ['ce654c93-a76f-46b7-97bf-799485801c12'],
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  behaviors?: string[];

  @ApiProperty({
    description: 'State instructions',
    type: [BehaviorStateInstructionDto],
  })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => BehaviorStateInstructionDto)
  stateInstructions?: BehaviorStateInstructionDto[];
}
