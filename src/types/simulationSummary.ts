export interface SkillCoverage {
  iconUrl: string;
  category: string;
  percentage: number;
}

export interface EmotionalMovement {
  startTime: number;
  level: number;
}

export interface SimulationSkillsResponse {
  skillCoverage: SkillCoverage[];
  emotionalMovement: EmotionalMovement[];
}
