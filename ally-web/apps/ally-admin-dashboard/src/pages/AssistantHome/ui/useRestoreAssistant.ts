import { toast } from "sonner";

import { useRestoreChatbotMutation } from "@api";

import { fill, HOME } from "../copy";

/**
 * Restore a removed assistant (the Archived tab, or its read-only page). It comes back paused,
 * and the toast says how to finish: turn it on, and reconnect its WhatsApp number if it had one.
 */
export const useRestoreAssistant = () => {
  const [restore, { isLoading }] = useRestoreChatbotMutation();
  const run = async (bot: { id: string; name: string }): Promise<boolean> => {
    try {
      await restore(bot.id).unwrap();
      toast.success(fill(HOME.archived.restored, { name: bot.name }));
      return true;
    } catch {
      toast.error(HOME.archived.restoreFailed);
      return false;
    }
  };
  return { restore: run, restoring: isLoading };
};
