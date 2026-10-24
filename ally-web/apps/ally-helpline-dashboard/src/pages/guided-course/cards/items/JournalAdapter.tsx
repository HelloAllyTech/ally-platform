import { FC } from "react";

import type { StartJournalItemPayload } from "@types";

import { JournalItemPlayer } from "../../../track-player/components/players/JournalItemPlayer";

import type { ItemAdapterProps } from "./types";

/** Journal, inline. The words are the learner's; Ally never writes them (plan §11 D-2). */
const JournalAdapter: FC<ItemAdapterProps<StartJournalItemPayload>> = ({
  payload,
  itemId,
  alreadyCompleted,
  onCompleted,
}) => (
  <JournalItemPlayer
    payload={payload}
    itemId={itemId}
    alreadyCompleted={alreadyCompleted}
    onCompleted={onCompleted}
  />
);

export default JournalAdapter;
