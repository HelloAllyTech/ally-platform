import React, { useMemo, useRef, useState } from "react";

import { StaffConversations } from "../../ChatbotSupport/StaffConversations";
import { Inbox } from "../../Inbox";
import { chatbotAccess } from "../access";
import { AgreementGateContext } from "../agreement/context";
import { ResponderAgreementDialog, ResponderAgreementGate } from "../agreement/ResponderAgreement";
import { HOME } from "../copy";
import { SectionHead } from "../fields";
import { useReadOnly } from "../readOnly";

import type { SectionProps } from "./props";

/**
 * This assistant's inbox (chunk 11a): its chats from every channel, live, to take over and reply.
 * The same inbox as AI Chatbots → Inbox, held to this assistant.
 *
 * Stage 1b: a Responder accepts the responder agreement before the chats open; anyone else who
 * takes over or replies and is refused for it (`responder_agreement_required`) gets the agreement
 * in a dialog and carries on once they accept.
 *
 * Stage 8: Ally staff (read-only) get the inbox read-only, and only while an owner's grant is live.
 */
export const ConversationsSection: React.FC<SectionProps> = ({ bot }) => {
  const [asking, setAsking] = useState(false);
  // TF1 round 2 (Saathi B-11): what they were doing (Take over) carries on once they accept.
  const then = useRef<(() => void) | null>(null);
  const gate = useMemo(
    () => ({
      require: (next?: () => void) => {
        then.current = next ?? null;
        setAsking(true);
      },
    }),
    [],
  );
  const { responderOnly } = chatbotAccess(bot);
  const readOnly = useReadOnly();
  if (readOnly) {
    return (
      <>
        <SectionHead
          title={HOME.sections.conversations}
          subtitle={HOME.subtitles.conversations}
          help={HOME.help.conversations}
        />
        <StaffConversations chatbotId={bot.id} />
      </>
    );
  }
  return (
    <AgreementGateContext.Provider value={gate}>
      <SectionHead
        title={HOME.sections.conversations}
        subtitle={HOME.subtitles.conversations}
        help={HOME.help.conversations}
      />
      <ResponderAgreementGate required={responderOnly}>
        {/* The app bar, the assistant's header and this title sit above the panel: about 260px. */}
        <div style={{ ["--ally-inbox-top" as string]: "260px" }}>
          <Inbox chatbotId={bot.id} />
        </div>
      </ResponderAgreementGate>
      {asking && (
        <ResponderAgreementDialog
          onClose={() => setAsking(false)}
          onAccepted={() => {
            const next = then.current;
            then.current = null;
            next?.();
          }}
        />
      )}
    </AgreementGateContext.Provider>
  );
};
