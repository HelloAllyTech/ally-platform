import { createContext, useContext } from "react";

/**
 * Builder's pages mounted inside Roadmap's Agent tab (plans/roadmap-builder-merge §4.1). Embedded,
 * a page drops its own "← Builder" header link, because the Roadmap's tab row is the way back.
 * Read-only (Builders; Owners edit) hides the controls that change anything: new and edited rules,
 * rule offers, eval runs and fixture imports. The server still decides; this only stops a control
 * that would answer 403 from showing.
 */
export interface AgentEmbed {
  embedded: boolean;
  readOnly: boolean;
}

export const AgentEmbedContext = createContext<AgentEmbed>({ embedded: false, readOnly: false });

export const useAgentEmbed = (): AgentEmbed => useContext(AgentEmbedContext);
