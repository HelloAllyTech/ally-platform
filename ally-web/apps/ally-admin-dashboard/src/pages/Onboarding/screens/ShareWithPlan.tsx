import React from "react";

import { useGetPublishUseQuery, useGetTemplateOriginQuery } from "@api";

import { ShareScreen } from "./Share";

type ShareProps = React.ComponentProps<typeof ShareScreen>;

/**
 * The Share screen with the plan's count (CR1 §C3): "This uses 1 of your 3 assistants", or the
 * plan's refusal with publishing switched off. A draft with no assistant yet has nothing to ask.
 */
export const ShareWithPlan: React.FC<Omit<ShareProps, "publishUse" | "examplesLeft">> = props => {
  const chatbotId = props.view.chatbotId ?? "";
  const { data } = useGetPublishUseQuery(chatbotId, { skip: !chatbotId });
  // T1: a template's examples still in a list are asked about before going live.
  const origin = useGetTemplateOriginQuery(chatbotId, { skip: !chatbotId }).data;
  return (
    <ShareScreen
      {...props}
      publishUse={data ?? null}
      examplesLeft={origin?.examples_left ?? null}
    />
  );
};
