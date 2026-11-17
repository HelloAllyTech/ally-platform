import * as crypto from 'crypto';

// ── Suggested lead (§4.11, §5.7b) ────────────────────────────────────────────

export interface LeadCandidateFacts {
  userId: number;
  /** Ideas they lead now that have not shipped or closed. */
  leading: number;
  /** Past ideas they led, counted per app the idea's releases touched. */
  ideasByApp: Record<string, number>;
}

export interface ScoredLeadCandidate {
  userId: number;
  leading: number;
  limit: number;
  freeSlots: number;
  /** The apps behind `matchingIdeas`, most first. */
  appsTouched: string[];
  matchingIdeas: number;
  score: number;
}

/** A free slot outweighs any amount of history: an overloaded lead is the wrong pick. */
const SLOT_WEIGHT = 100;

/**
 * The suggested lead: "the Builder who has the most free slots and has
 * touched the same apps before" (§4.11). Deterministic, no model. Pure.
 *
 * `ideaApps` is what the idea is known to touch; when nothing is known yet
 * (the usual case at triage) every app the person has shipped counts.
 * Ties go to the person leading fewer ideas, then the lower id, so the
 * suggestion is stable between two loads of the same screen.
 */
export function scoreLeadCandidates(
  candidates: LeadCandidateFacts[],
  limit: number,
  ideaApps: string[],
): ScoredLeadCandidate[] {
  const wanted = new Set(ideaApps);
  return candidates
    .map((c) => {
      const apps = Object.entries(c.ideasByApp)
        .filter(([app]) => !wanted.size || wanted.has(app))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const matchingIdeas = apps.reduce((sum, [, n]) => sum + n, 0);
      const freeSlots = Math.max(0, limit - c.leading);
      return {
        userId: c.userId,
        leading: c.leading,
        limit,
        freeSlots,
        appsTouched: apps.map(([app]) => app),
        matchingIdeas,
        score:
          freeSlots * SLOT_WEIGHT + Math.min(matchingIdeas, SLOT_WEIGHT - 1),
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.leading - b.leading || a.userId - b.userId,
    );
}

// ── Review undo (§4.6: 8-second undo, one token for a batch) ────────────────

/** What one review changed, and what it replaced. */
export interface ReviewUndoItem {
  id: string;
  code: string;
  sessionId: string | null;
  prev: {
    reviewState: string | null;
    reviewedBy: number | null;
    reviewedAt: string | null;
    declineReason: string | null;
    leadUserId: number | null;
  };
  next: { reviewState: string | null; leadUserId: number | null };
}

export interface ReviewUndoPayload {
  v: 1;
  /** The Owner who reviewed; only they can undo. */
  u: number;
  /** Expiry, epoch ms. */
  exp: number;
  items: ReviewUndoItem[];
}

/** The client offers undo for 8 s; the server allows for the trip home. */
export const REVIEW_UNDO_TTL_MS = 30_000;
const KEY_LABEL = 'ally:roadmap-v2:review-undo:v1';

/** A key of its own, derived from the app secret under a label (like the readiness token). */
export function reviewUndoKey(secret: string): Buffer {
  return crypto.createHmac('sha256', secret).update(KEY_LABEL).digest();
}

export function signReviewUndo(
  payload: ReviewUndoPayload,
  key: Buffer,
): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * The payload, or why not: `invalid` for anything malformed or tampered with,
 * `expired` past its window. Never throws.
 */
export function readReviewUndo(
  token: string,
  key: Buffer,
  now = Date.now(),
):
  | { ok: true; payload: ReviewUndoPayload }
  | { ok: false; reason: 'invalid' | 'expired' } {
  const [body, sig, extra] = String(token ?? '').split('.');
  if (!body || !sig || extra !== undefined)
    return { ok: false, reason: 'invalid' };
  const expected = crypto
    .createHmac('sha256', key)
    .update(body)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'invalid' };
  }
  let payload: ReviewUndoPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (payload?.v !== 1 || !Array.isArray(payload.items)) {
    return { ok: false, reason: 'invalid' };
  }
  if (!(payload.exp > now)) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}
