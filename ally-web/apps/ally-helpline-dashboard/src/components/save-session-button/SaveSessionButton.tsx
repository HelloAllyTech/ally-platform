import { FC, useState } from "react";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useSaveSessionBookmarkMutation } from "@api";

interface SaveSessionButtonProps {
  sessionId: string;
}

/** Lets a learner save a finished roleplay session to come back to. */
export const SaveSessionButton: FC<SaveSessionButtonProps> = ({ sessionId }) => {
  const { t } = useTranslation();
  const [saveBookmark, { isLoading }] = useSaveSessionBookmarkMutation();
  const [saved, setSaved] = useState(false);

  const handleClick = async () => {
    try {
      await saveBookmark({ sessionId, source: "web" }).unwrap();
      setSaved(true);
      toast.success(t("postSim.common.sessionSaved", "Session saved"));
    } catch (error) {
      if ((error as { status?: number })?.status === 409) {
        setSaved(true);
        toast.info(t("postSim.common.sessionAlreadySaved", "You already saved this session"));
        return;
      }
      toast.error(t("postSim.common.sessionSaveFailed", "Couldn't save this session. Try again."));
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={isLoading || saved}
      className="font-primary text-sm underline disabled:no-underline disabled:opacity-60"
    >
      {saved
        ? t("postSim.common.sessionSavedLabel", "Saved")
        : t("postSim.common.saveSession", "Save this session")}
    </button>
  );
};
