import type { EntityManager } from 'typeorm';
import type { ContactSource } from './run-failed-reply';

/**
 * The business's sourced facts: the site reader's and the owner's, on its draft, plus the owner's
 * notes (Q3-fast). Read for the fixed replies that name a number (the run-failed and emergency
 * replies) and for the run's `business_contact`. Never throws: a lookup failure is no facts, and
 * the reply goes out without the number.
 */
export async function businessFacts(
  manager: EntityManager,
  chatbotId: string,
): Promise<ContactSource[]> {
  try {
    const rows = await manager.query<
      { learned: { facts?: { section?: string; text?: string }[] } | null }[]
    >(
      `SELECT learned FROM bot_drafts
        WHERE chatbot_id = $1
        ORDER BY "updatedAt" DESC
        LIMIT 1`,
      [chatbotId],
    );
    const facts: ContactSource[] = (rows?.[0]?.learned?.facts ?? [])
      .filter((fact) => typeof fact?.text === 'string')
      .map((fact) => ({ section: fact.section, text: fact.text as string }));
    // The owner's notes too: what they typed during setup, which the facts may not carry.
    const notes = await manager.query<{ raw_text: string | null }[]>(
      `SELECT raw_text FROM kb_documents
        WHERE owner_chatbot_id = $1 AND title = 'Owner notes' AND archived_at IS NULL
        ORDER BY "updatedAt" DESC
        LIMIT 1`,
      [chatbotId],
    );
    const note = notes?.[0]?.raw_text?.trim();
    return note ? [...facts, { section: 'owner_notes', text: note }] : facts;
  } catch {
    return [];
  }
}
