import { FC } from "react";

import type { StartQuizItemPayload } from "@types";

import { QuizItemPlayer } from "../../../track-player/components/players/quiz/QuizItemPlayer";

import type { ItemAdapterProps } from "./types";

/** Quiz, inline. The results screen's "next" folds the card back into the conversation. */
const QuizAdapter: FC<ItemAdapterProps<StartQuizItemPayload>> = ({
  payload,
  itemId,
  onCompleted,
  onClose,
}) => (
  <QuizItemPlayer
    payload={payload}
    itemId={itemId}
    onCompleted={onCompleted}
    onRequestNext={onClose}
  />
);

export default QuizAdapter;
