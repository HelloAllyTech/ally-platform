import React from "react";

import { KnowledgeTools } from "./KnowledgeTools";
import { KnowsSection } from "./Knows";
import { Parts } from "../ui/Parts";
import { ListsSection } from "../userLists/ListsSection";

import type { SectionProps } from "./props";
import type { KnowledgePart } from "../sections";

/**
 * Knowledge (stage 2): What it knows and Lists as two parts. The assistant's own tools no longer
 * sit among the lists: memory and hand over are in Settings, pages are in Channels.
 */
export const KnowledgeSection: React.FC<
  SectionProps & {
    part: KnowledgePart;
    onPart: (part: KnowledgePart) => void;
    /** A list to open first (`?tool=<key>`). */
    openKey?: string | null;
  }
> = ({ part, onPart, openKey, ...props }) => (
  <>
    <Parts parts={["knows", "lists"]} value={part} onChange={onPart} testId="knowledge-parts" />
    <div id={`part-panel-${part}`} role="tabpanel" aria-labelledby={`part-tab-${part}`}>
      {part === "lists" ? (
        <ListsSection {...props} withTools={false} openKey={openKey} />
      ) : (
        <>
          <KnowsSection {...props} />
          <KnowledgeTools bot={props.bot} canEdit={props.canEdit} canManage={props.canManage} />
        </>
      )}
    </div>
  </>
);
