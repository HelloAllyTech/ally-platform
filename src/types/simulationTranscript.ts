import {SimulationMessageTag} from '@/services/simulationTranscriptApi';

/**
 * Represents a formatted message in a simulation transcript
 */
export interface SimulationTranscriptMessage {
  id: number;
  time: string;
  message: string;
  learner: boolean;
  startSeconds: number;
  tags?: SimulationMessageTag[];
}
