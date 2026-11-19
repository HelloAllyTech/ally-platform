import React from "react";

import { useGetPublishUseQuery } from "@api";

import { ShareScreen } from "./Share";

type ShareProps = React.ComponentProps<typeof ShareScreen>;

/**
 * The Share screen with the plan's count (CR1 §C3): "This uses 1 of your 3 assistants", or the
 * plan's refusal with publishing switched off. A draft with no assistant yet has nothing to ask.
 */
export const ShareWithPlan: React.FC<Omit<ShareProps, "publishUse">> = props => {
  const chatbotId = props.view.chatbotId ?? "";
  const { data } = useGetPublishUseQuery(chatbotId, { skip: !chatbotId });
  return <ShareScreen {...props} publishUse={data ?? null} />;
};
