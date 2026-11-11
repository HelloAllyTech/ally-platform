import React, { useState } from "react";

import { useArchiveChatbotMutation } from "@api";
import { Button } from "@components/v2";

import { fill, HOME } from "../copy";
import { Sheet } from "./Sheet";

const t = HOME.overview;

/**
 * Asks before an assistant is removed (archived): what stops, and that its conversations are
 * kept. Used on the assistant's Overview and on its card in the assistants list. Keep it is the
 * safe choice, so it takes focus first; while the request runs, Remove can't be sent twice.
 */
export const RemoveDialog: React.FC<{
  bot: { id: string; name: string };
  onClose: () => void;
  onRemoved?: () => void;
}> = ({ bot, onClose, onRemoved }) => {
  const [archive, { isLoading }] = useArchiveChatbotMutation();
  const [failed, setFailed] = useState(false);
  const title = fill(t.removeTitle, { name: bot.name });

  const remove = async () => {
    setFailed(false);
    try {
      await archive(bot.id).unwrap();
      onClose();
      onRemoved?.();
    } catch {
      setFailed(true);
    }
  };

  return (
    <Sheet side="center" label={title} onClose={onClose} testId="remove-dialog">
      <div className="ally-remove">
        <h2 className="ally-heading">{title}</h2>
        <p className="ally-small">{t.removeBody}</p>
        {failed && (
          <p className="ally-small ally-remove__error" role="alert">
            {t.removeFailed}
          </p>
        )}
        <div className="ally-remove__actions">
          <Button onClick={onClose}>{t.removeKeep}</Button>
          <Button
            variant="primary"
            className="ally-remove__confirm"
            disabled={isLoading}
            onClick={() => void remove()}
          >
            {t.removeConfirm}
          </Button>
        </div>
      </div>
    </Sheet>
  );
};
