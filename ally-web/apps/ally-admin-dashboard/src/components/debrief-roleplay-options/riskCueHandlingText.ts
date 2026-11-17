import { en } from "@constants";
import { RiskCueOption } from "@types";

/** What an option does with a risk cue, in plain words. */
export const riskCueHandlingText = (o: Pick<RiskCueOption, "handling">): string =>
  o.handling === "assessed"
    ? en.debriefRoleplayOptions.handlingAssessed
    : en.debriefRoleplayOptions.handlingAlarm;
