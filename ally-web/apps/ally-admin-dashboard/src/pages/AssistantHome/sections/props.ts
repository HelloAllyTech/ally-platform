import type { AssistantHomeView, Chatbot } from "@types";

import type { SectionId } from "../sections";

/** What every section is given by the home. */
export interface SectionProps {
  bot: Chatbot;
  home: AssistantHomeView;
  /** Editors and owners change things; viewers see everything read-only. */
  canEdit: boolean;
  /** Owners also manage the team and channels, and can remove the assistant. */
  canManage: boolean;
  go: (section: SectionId) => void;
}
