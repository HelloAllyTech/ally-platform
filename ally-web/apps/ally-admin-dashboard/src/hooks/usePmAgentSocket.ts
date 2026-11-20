import { useRef } from "react";

import { useDispatch } from "react-redux";

import { baseAPI } from "@api";
import { TAG_TYPES } from "@constants";

import { useAllySocket } from "./useAllySocket";

const NAMESPACE = "pm-agent";

/**
 * Live nudges from the `/pm-agent` namespace: `card.updated` and `state.updated` only say that
 * something changed, so each one invalidates the matching RTK Query tags and the page refetches.
 * The socket is an optimisation: the page also polls `GET /state` every 30 s.
 */
export const usePmAgentSocket = (enabled = true) => {
  const dispatch = useDispatch();
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const handlersRef = useRef<Record<string, (payload: unknown) => void>>({
    "card.updated": () => {
      dispatchRef.current(
        baseAPI.util.invalidateTags([
          TAG_TYPES.PM_AGENT_CARDS,
          TAG_TYPES.PM_AGENT_TRACKING,
          TAG_TYPES.PM_AGENT_STATE,
        ]),
      );
    },
    "state.updated": () => {
      dispatchRef.current(baseAPI.util.invalidateTags([TAG_TYPES.PM_AGENT_STATE]));
    },
  });

  useAllySocket({
    namespace: NAMESPACE,
    label: "pm-agent",
    handlers: handlersRef.current,
    enabled,
    // Anything pushed while the socket was down is lost: refetch the lot.
    onReconnected: () => {
      dispatchRef.current(
        baseAPI.util.invalidateTags([
          TAG_TYPES.PM_AGENT_CARDS,
          TAG_TYPES.PM_AGENT_TRACKING,
          TAG_TYPES.PM_AGENT_STATE,
        ]),
      );
    },
  });
};
