/**
 * Agents v2 dashboard components (DESIGN.md §4), on top of `./core` (which the bot page uses on
 * its own). Importing this module loads the v2 fonts, tokens and component styles.
 */
import "./v2.css";

export * from "./core";
export {
  BuildSteps,
  ColourPicker,
  DesignCard,
  FindingLine,
  LearnedCard,
  SafetyCard,
  Segmented,
  SourceChip,
} from "./Cards";
export type { DesignCardLabels, LearnedCardLabels } from "./Cards";
export { CheckRow, GapCard, MeasureCard } from "./Checkup";
export type { CheckRowLabels, CheckStatus, GapCardLabels } from "./Checkup";
export { PhonePreview } from "./PhonePreview";
export { StepFrame } from "./StepFrame";
export type { StepFrameLabels } from "./StepFrame";
export { TellMeSomethingElse } from "./TellMeSomethingElse";
