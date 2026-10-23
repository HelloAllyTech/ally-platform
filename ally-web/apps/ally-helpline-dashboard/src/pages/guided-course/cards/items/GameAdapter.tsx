import { FC } from "react";

import type { StartGameItemPayload } from "@types";

import { GameItemPlayer } from "../../../track-player/components/players/GameItemPlayer";

import type { ItemAdapterProps } from "./types";

/**
 * Game, in the Theatre. The player reports completion from an effect keyed
 * on `onCompleted`, so the host hands it a stable callback: a re-render must
 * never post a second card event.
 */
const GameAdapter: FC<ItemAdapterProps<StartGameItemPayload>> = ({
  payload,
  itemId,
  onCompleted,
}) => <GameItemPlayer payload={payload} itemId={itemId} onCompleted={onCompleted} />;

export default GameAdapter;
