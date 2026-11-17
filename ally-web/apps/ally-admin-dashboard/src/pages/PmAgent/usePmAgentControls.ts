import { useCallback, useEffect, useState } from "react";

import { toast } from "sonner";

import { useRunPmAgentNowMutation, useUpdatePmAgentSettingsMutation } from "@api";
import type { PmSettingsPatch } from "@types";

import { copy } from "./copy";

/** Run now, resume builds, turn on, save settings: shared by the header, banners and Agent view. */
export const usePmAgentControls = () => {
  const [runNowMutation, { isLoading: running }] = useRunPmAgentNowMutation();
  const [updateSettings, { isLoading: saving }] = useUpdatePmAgentSettingsMutation();

  const runNow = useCallback(async () => {
    try {
      const res = await runNowMutation().unwrap();
      if (res.started) toast.success(copy.runStarted);
      else toast.message(copy.runNotStarted(res.reason));
    } catch {
      toast.error(copy.actionFailed);
    }
  }, [runNowMutation]);

  const save = useCallback(
    async (patch: PmSettingsPatch, successMessage?: string): Promise<boolean> => {
      try {
        await updateSettings(patch).unwrap();
        if (successMessage) toast.success(successMessage);
        return true;
      } catch {
        toast.error(copy.agent.saveFailed);
        return false;
      }
    },
    [updateSettings],
  );

  const turnOn = useCallback(() => save({ enabled: true }), [save]);

  return { runNow, running, save, saving, turnOn };
};

/** `navigator.onLine`, kept current. */
export const useOnline = (): boolean => {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
};
