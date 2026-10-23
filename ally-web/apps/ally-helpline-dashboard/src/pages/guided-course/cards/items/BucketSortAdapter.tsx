import { FC } from "react";

import type { StartBucketSortItemPayload } from "@types";

import { BucketSortPlayer } from "../../../track-player/components/players/BucketSortPlayer";

import type { ItemAdapterProps } from "./types";

/** Bucket sort, in the Shelf at utility width so the conversation stays in view. */
const BucketSortAdapter: FC<ItemAdapterProps<StartBucketSortItemPayload>> = ({
  payload,
  itemId,
  onCompleted,
  onClose,
}) => (
  <BucketSortPlayer
    payload={payload}
    itemId={itemId}
    onCompleted={onCompleted}
    onRequestNext={onClose}
  />
);

export default BucketSortAdapter;
