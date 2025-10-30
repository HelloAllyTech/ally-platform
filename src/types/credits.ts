export interface SimulationCredits {
  creditLimit: number;
  consumedCredits: number;
  secondsAllowedPerCredit: number;
}

export interface SimulationCreditsState {
  credits: SimulationCredits | null;
}
