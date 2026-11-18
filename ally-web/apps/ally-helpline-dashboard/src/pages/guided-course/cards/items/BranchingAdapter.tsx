import { FC } from "react";

import type { StartBranchingScenarioItemPayload } from "@types";

import { BranchingScenarioPlayer } from "../../../track-player/components/players/BranchingScenarioPlayer";

import type { ItemAdapterProps } from "./types";

/**
 * Scenario quiz, inline. "Next" and "back to course" both return to the
 * conversation. Always classic: a STORY scenario needs the full screen, which
 * an inline card can't give it.
 */
const BranchingAdapter: FC<ItemAdapterProps<StartBranchingScenarioItemPayload>> = ({
  payload,
  itemId,
  onCompleted,
  onClose,
}) => (
  <BranchingScenarioPlayer
    payload={payload}
    itemId={itemId}
    onCompleted={onCompleted}
    onRequestNext={onClose}
    onBackToCourse={onClose}
    forceClassic
  />
);

export default BranchingAdapter;
