import React from "react";

import { useGetAssistantHomeQuery } from "@api";
import type { AssistantHomeView } from "@types";

import { HOME } from "./copy";
import { LinesField } from "./fields";
import { useHomeField } from "./useHomeField";

const Field: React.FC<{ botId: string; home: AssistantHomeView }> = ({ botId, home }) => {
  const avoid = useHomeField(botId, "avoidTopics", home.fields.avoidTopics, HOME.saving.failed);
  return (
    <LinesField
      label={HOME.avoid.label}
      hint={HOME.avoid.hint}
      addLabel={HOME.avoid.add}
      removeLabel={HOME.safety.remove}
      field={avoid}
      max={10}
      maxLength={80}
      disabled={!home.canEdit}
    />
  );
};

/**
 * "Anything it shouldn't talk about?" in Make it yours (chunk 20a-2). Topics live on the
 * assistant itself, so this is the same field as on the home's Safety section, saved the same way.
 */
export const AvoidTopics: React.FC<{ botId: string | null }> = ({ botId }) => {
  const { data } = useGetAssistantHomeQuery(botId ?? "", { skip: !botId });
  if (!botId || !data) return null;
  return <Field botId={botId} home={data} />;
};
