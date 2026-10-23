import { FC } from "react";

import type { StartVideoItemPayload } from "@types";

import { VideoItemPlayer } from "../../../track-player/components/players/VideoItemPlayer";

import type { ItemAdapterProps } from "./types";

/** Video, in the Shelf. Uses the player's optional `onCompleted`, which classic doesn't pass. */
const VideoAdapter: FC<ItemAdapterProps<StartVideoItemPayload>> = ({
  payload,
  itemId,
  trackId,
  alreadyCompleted,
  onCompleted,
}) => (
  <VideoItemPlayer
    payload={payload}
    itemId={itemId}
    trackId={trackId}
    alreadyCompleted={alreadyCompleted}
    onCompleted={onCompleted}
  />
);

export default VideoAdapter;
