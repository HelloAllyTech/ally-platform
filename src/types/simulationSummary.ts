export interface SkillCoverage {
  category: string;
  percentage: number;
}

export interface EmotionalMovement {
  sessionTime: number;
  level: number;
}

export interface SimulationSkillsResponse {
  skillCoverage: SkillCoverage[];
  emotionalMovement: EmotionalMovement[];
}
