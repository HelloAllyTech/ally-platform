import { BehaviorInstructionWithBehaviorsDto } from '../dto/behavior-instruction-response.dto';
import { BehaviorResponseDto } from '../dto/behavior-response.dto';
import { Behavior } from '../entity/behavior.entity';
import { ScenarioBehaviorInstructionBehavior } from '../entity/scenario-behavior-instruction-behavior.entity';
import { ScenarioBehaviorInstruction } from '../entity/scenario-behavior-instruction.entity';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';
import {
  BEHAVIOR_INSTRUCTION_SHOULD_DO_SCORE,
  BEHAVIOR_INSTRUCTION_SHOULD_NOT_DO_SCORE,
} from '../constants/scenario-behavior-instuctions.constants';
import { FormattedBehaviorInstructionForLivekit } from '../type/scenario-behavior-instructions.type';

/**
 * The points one detection of a behaviour instruction is worth: the authored
 * score, or the category default when none was set (NULL on every row that
 * pre-dates the column, and on rows whose author left the default).
 */
export const resolveBehaviorInstructionScore = (
  category: BehaviorInstructionCategory,
  score?: number | null,
): number =>
  score ??
  (category === BehaviorInstructionCategory.SHOULD_DO
    ? BEHAVIOR_INSTRUCTION_SHOULD_DO_SCORE
    : BEHAVIOR_INSTRUCTION_SHOULD_NOT_DO_SCORE);

export const formattedScenarioBehaviorInstructionsResponse = ({
  behaviorInstructions,
  behaviorMappings,
  behaviors,
}: {
  behaviorInstructions: ScenarioBehaviorInstruction[];
  behaviorMappings: ScenarioBehaviorInstructionBehavior[];
  behaviors: Behavior[];
}): BehaviorInstructionWithBehaviorsDto[] => {
  const behaviorMap = new Map<string, { id: string; name: string }>();
  behaviors.forEach((behavior) => {
    behaviorMap.set(behavior.id, {
      id: behavior.id,
      name: behavior.name,
    });
  });

  // Map of instructionId -> behaviorIds for quick lookup
  const instructionBehaviorMap = new Map<string, string[]>();
  behaviorMappings.forEach((mapping) => {
    const existing =
      instructionBehaviorMap.get(mapping.scenarioBehaviorInstructionId) || [];
    existing.push(mapping.behaviorId);
    instructionBehaviorMap.set(mapping.scenarioBehaviorInstructionId, existing);
  });

  // Combine instructions with their behaviors
  const instructionsWithBehaviors: BehaviorInstructionWithBehaviorsDto[] =
    behaviorInstructions.map((instruction) => {
      const behaviorIdsForInstruction =
        instructionBehaviorMap.get(instruction.id) || [];
      const behaviorsForInstruction = behaviorIdsForInstruction
        .map((behaviorId) => behaviorMap.get(behaviorId))
        .filter((behavior): behavior is BehaviorResponseDto => !!behavior);

      return {
        id: instruction.id,
        category: instruction.category,
        score: instruction.score ?? null,
        behaviors: behaviorsForInstruction,
        stateInstructions: instruction.stateInstructions,
      };
    });

  return instructionsWithBehaviors;
};

export const formatBehaviorInstructionsForLivekitMetadata = (
  behaviorInstructions: BehaviorInstructionWithBehaviorsDto[],
): FormattedBehaviorInstructionForLivekit[] => {
  return behaviorInstructions.map((instruction) => {
    const score = resolveBehaviorInstructionScore(
      instruction.category,
      instruction.score,
    );

    return {
      category: instruction.category,
      behaviors: instruction.behaviors.map((behavior) => behavior.name),
      score,
      behaviorInstructionId: instruction.id,
      stateMatchedInstructions: instruction.stateInstructions,
    };
  });
};
