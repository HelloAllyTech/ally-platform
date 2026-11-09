import { COPY, fill } from "./copy";

import type { BotDraftView } from "./types";

/**
 * The defaults a purpose set, as the confirmation after building says them (copy §24, chunk
 * 20a-2): "I've set it up for Bring in customers: Pre-chat: name, phone, what they're looking
 * for · Access: anyone you choose. …". Null before a purpose is chosen.
 */
export const defaultsConfirmation = (view: BotDraftView): string | null => {
  const id = view.draft.purpose;
  if (!id) return null;
  const card = view.designs?.find(d => d.id === id);
  if (!card) return null;
  const t = COPY.purposes;
  const fields = view.draft.prechat.map(field => field.label.toLowerCase()).join(", ");
  const defaults = [
    fill(t.preChat, { fields: fields || t.nothingBefore }),
    fill(t.access, {
      access: view.draft.access.mode === "organisation" ? t.organisation : t.anyone,
    }),
  ].join(" · ");
  return fill(t.confirmation, { purpose: card.title, defaults });
};
