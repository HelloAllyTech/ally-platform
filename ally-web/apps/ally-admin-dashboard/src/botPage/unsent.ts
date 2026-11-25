import type { ChatItem } from "./screens/Chat";

/**
 * Messages that didn't reach us (TF1 round 2, Sahyog N-14): offline, or the server down or
 * failing. They stay in the thread as not sent, with Send again, and survive a reload through
 * sessionStorage, per page. Storage can be missing or blocked: then they last until the reload.
 */
export interface UnsentMessage {
  id: string;
  text: string;
  /** A tap's token, sent again with its label. */
  action?: string;
  /** When it was tried (ms): a server copy from before then isn't this one. */
  at: number;
}

const keyFor = (slug: string) => `ally-bp-unsent:${slug}`;

export function readUnsent(slug: string): UnsentMessage[] {
  try {
    const raw = window.sessionStorage.getItem(keyFor(slug));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list)
      ? list.filter(
          (m): m is UnsentMessage =>
            Boolean(m) && typeof m.id === "string" && typeof m.text === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function writeUnsent(slug: string, list: UnsentMessage[]): void {
  try {
    if (list.length) window.sessionStorage.setItem(keyFor(slug), JSON.stringify(list));
    else window.sessionStorage.removeItem(keyFor(slug));
  } catch {
    // No storage: the message stays in the thread until a reload.
  }
}

export function keepUnsent(slug: string, message: UnsentMessage): void {
  writeUnsent(slug, [...readUnsent(slug).filter(m => m.id !== message.id), message]);
}

/** Forget an unsent message: sent again, sent anew with the same words, or the chat restarted. */
export function dropUnsent(slug: string, match: (m: UnsentMessage) => boolean): void {
  writeUnsent(
    slug,
    readUnsent(slug).filter(m => !match(m)),
  );
}

export function clearUnsent(slug: string): void {
  writeUnsent(slug, []);
}

const AT_SLACK_MS = 60_000;

/**
 * The thread after a reload: the server's messages, then each unsent one. When the server did get
 * it (a user message with the same words, stored since it was tried), the server's copy stands:
 * answered (an assistant reply after it), it is forgotten; unanswered, that copy is marked not
 * sent. Send again then sends it once more, so the server may hold it twice (accepted: the
 * person saw no answer).
 */
export function withUnsent(
  slug: string,
  items: ChatItem[],
  stored: { id: string; role: string; createdAt?: string }[],
): ChatItem[] {
  const unsent = readUnsent(slug);
  if (!unsent.length) return items;
  const out = [...items];
  const keep: UnsentMessage[] = [];
  for (const m of unsent) {
    const found = lastMatch(out, m, stored);
    if (found >= 0) {
      if (
        out.slice(found + 1).some(item => item.role === "assistant" || item.role === "agent_human")
      ) {
        continue;
      }
      out[found] = { ...out[found], unsent: m.action ? { action: m.action } : {} };
      keep.push({ ...m, id: out[found].id });
      continue;
    }
    out.push({
      id: m.id,
      role: "user",
      text: m.text,
      citations: [],
      unsent: m.action ? { action: m.action } : {},
    });
    keep.push(m);
  }
  writeUnsent(slug, keep);
  return out;
}

/** The latest user message with these words, stored since it was tried. */
function lastMatch(
  items: ChatItem[],
  m: UnsentMessage,
  stored: { id: string; createdAt?: string }[],
): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.role !== "user" || item.text.trim() !== m.text.trim()) continue;
    const created = Date.parse(stored.find(s => s.id === item.id)?.createdAt ?? "");
    if (!Number.isFinite(created) || created >= m.at - AT_SLACK_MS) return i;
  }
  return -1;
}
