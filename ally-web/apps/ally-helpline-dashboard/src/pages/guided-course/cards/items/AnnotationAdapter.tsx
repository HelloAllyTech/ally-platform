import { FC } from "react";

import type { StartAnnotationItemPayload } from "@types";

import { AnnotationItemPlayer } from "../../../track-player/components/players/annotation/AnnotationItemPlayer";

import type { ItemAdapterProps } from "./types";

/** Transcript or note annotation, in the Theatre. */
const AnnotationAdapter: FC<ItemAdapterProps<StartAnnotationItemPayload>> = ({
  payload,
  itemId,
  alreadyCompleted,
  onCompleted,
}) => (
  <AnnotationItemPlayer
    payload={payload}
    itemId={itemId}
    alreadyCompleted={alreadyCompleted}
    onCompleted={onCompleted}
  />
);

export default AnnotationAdapter;
