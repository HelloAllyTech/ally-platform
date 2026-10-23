import { FC } from "react";

import type { StartCaseItemPayload, StartRoleplayItemPayload } from "@types";

import { RoleplayItemPlayer } from "../../../track-player/components/players/RoleplayItemPlayer";

import type { ItemAdapterProps } from "./types";

/**
 * Roleplay and case, in the Theatre: the existing pre-launch screen, then the
 * full-screen simulation. The return-to-track context carries
 * `returnTo: "guided"`, so the summary's Continue comes back to Ally.
 */
const RoleplayAdapter: FC<ItemAdapterProps<StartRoleplayItemPayload | StartCaseItemPayload>> = ({
  payload,
  trackId,
  item,
  alreadyCompleted,
  onBeforeLaunch,
  returnContext,
}) =>
  item ? (
    <RoleplayItemPlayer
      payload={payload}
      item={item}
      trackId={trackId}
      alreadyCompleted={alreadyCompleted}
      trackContextExtras={returnContext}
      onBeforeLaunch={onBeforeLaunch}
    />
  ) : null;

export default RoleplayAdapter;
