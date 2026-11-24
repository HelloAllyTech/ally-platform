import React, { useState } from "react";

import { Link } from "react-router-dom";

import { useDuplicateChatbotMutation } from "@api";
import { Button } from "@components/button";
import { ButtonVariant } from "@components/types";
import { ROUTES } from "@constants";

import { SAFETY_PRIVACY_COPY as C } from "../copy/safetyPrivacy";
import { Group } from "../fields";

/** Settings → Duplicate chatbot: a private draft copy you own (ally-be `POST :id/duplicate`). */
export const DuplicateChatbot: React.FC<{ botId: string; canEdit: boolean }> = ({
  botId,
  canEdit,
}) => {
  const [duplicate, state] = useDuplicateChatbotMutation();
  const [copyId, setCopyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Group title={C.duplicate.title} hint={C.duplicate.hint} testId="settings-duplicate">
      <div>
        <Button
          variant={ButtonVariant.SECONDARY}
          type="button"
          disabled={!canEdit || state.isLoading}
          onClick={async () => {
            setProblem(null);
            try {
              setCopyId((await duplicate(botId).unwrap()).chatbotId);
            } catch (error) {
              const m = (error as { data?: { message?: string } })?.data?.message;
              setProblem(typeof m === "string" && m.trim() ? m : C.duplicate.failed);
            }
          }}
        >
          {state.isLoading ? C.duplicate.working : C.duplicate.action}
        </Button>
      </div>
      {copyId && (
        <p className="ally-small" role="status">
          <Link className="ally-link" to={`${ROUTES.WHATSAPP_BOT}/${copyId}`}>
            {C.duplicate.done}
          </Link>
        </p>
      )}
      {problem && (
        <p className="ally-error" role="alert">
          {problem}
        </p>
      )}
    </Group>
  );
};
