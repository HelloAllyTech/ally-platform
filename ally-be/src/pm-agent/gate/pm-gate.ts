import { validateCardPayload } from '../dto/pm-card-payload.dto';
import { PmCardKind, PmCardStatus } from '../enum/pm-agent.enum';
import { PM_DEDUPE } from '../constants/pm-agent-pipeline.constants';
import {
  PmCandidate,
  PmDedupeItem,
  PmEvidenceRef,
} from '../pipeline/pm-pipeline.types';
import { looksLikeInjection } from '../util/fence.util';
import {
  LEAK_SCRUB_RULES,
  PUBLIC_SCRUB_RULES,
  scrubHits,
} from '../util/scrub.util';
import { similarity } from '../util/text-similarity.util';

export interface PmGateVerdict {
  pass: boolean;
  reasons: string[];
}

/** Every string in a payload, with its path; evidence ids are ids, not text. */
function strings(value: unknown, path = ''): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path, text: value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => strings(item, `${path}[${index}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'evidenceIds' && key !== 'questionKey')
      .flatMap(([key, item]) => strings(item, path ? `${path}.${key}` : key));
  }
  return [];
}

/** The texts a candidate is compared on for dedupe. */
export function candidateText(candidate: Pick<PmCandidate, 'payload'>): string {
  const p = candidate.payload ?? {};
  return [p.title, p.whyHeadline, ...(Array.isArray(p.change) ? p.change : [])]
    .filter(Boolean)
    .join(' ');
}

/**
 * Gate layer 1 — deterministic, cheapest first (plan §6). Pure: same input, same verdict.
 *
 *  - the payload contract (lengths, enums, unknown keys; an optional `metricRef` must name a
 *    measurable-metric catalog entry with that entry's params — impact/metric-catalog.ts);
 *  - every cited evidence id exists AND was fetched in this run;
 *  - the roadmap entry names a product goal that exists on the roadmap right now;
 *  - in the roadmap entry (`opportunity.*`, the only part filed and published), nothing a
 *    public-repo scrubber would redact; in the admin-only rest of the card, no real leak
 *    (tenant names, emails, secrets, internal URLs). An accepted card is filed to the roadmap,
 *    which is published, so a candidate that needs redacting is dropped, not silently edited;
 *  - nothing instruction-shaped (a card becomes a roadmap entry other agents read).
 *
 * The release-pipeline rules (no ally-mobile, no libs/-only) went with Accept → Builder:
 * the agent proposes, it no longer ships.
 */
export function deterministicGate(
  candidate: PmCandidate,
  runEvidence: ReadonlyMap<string, PmEvidenceRef>,
  tenantNames: string[],
  /** The roadmap's product goal names. Omitted = not checked (unit tests of other rules). */
  productGoals?: readonly string[],
): PmGateVerdict {
  const reasons = [...validateCardPayload(candidate.kind, candidate.payload)];
  const p = candidate.payload ?? {};

  if (candidate.kind === PmCardKind.RECOMMENDATION) {
    const ids: string[] = Array.isArray(p.evidenceIds) ? p.evidenceIds : [];
    if (!ids.length) reasons.push('evidence: cites nothing');
    for (const id of ids) {
      if (!runEvidence.has(String(id))) {
        reasons.push(
          `evidence: ${String(id).slice(0, 40)} is not from this run`,
        );
      }
    }
    const goal = p.opportunity?.productGoal;
    if (
      productGoals &&
      typeof goal === 'string' &&
      !productGoals.includes(goal)
    ) {
      reasons.push(
        `opportunity.productGoal: "${goal.slice(0, 60)}" is not a roadmap product goal`,
      );
    }
  }

  for (const { path, text } of strings(p)) {
    // Only the roadmap entry (opportunity.*) is published; every other field stays on the
    // admin-only card, where code-like text (ids, migration timestamps) is normal. Those keep
    // the real-leak rules only (prod 2026-11-24: a gpt-5 card died on plan.defaultsChosen).
    const published = path.startsWith('opportunity.');
    const hits = scrubHits(
      text,
      { tenantNames },
      published ? PUBLIC_SCRUB_RULES : LEAK_SCRUB_RULES,
    );
    if (hits.length) {
      reasons.push(
        `${path}: contains text a public PRD must not carry (${hits.join(', ')})`,
      );
    }
    if (looksLikeInjection(text)) {
      reasons.push(`${path}: instruction-shaped text`);
    }
  }
  return { pass: reasons.length === 0, reasons };
}

const BLOCKING_CARD_STATUSES = new Set<string>(
  Object.values(PmCardStatus).filter(
    (status) =>
      ![
        PmCardStatus.REJECTED,
        PmCardStatus.FEEDBACK_CLOSED,
        PmCardStatus.EXPIRED,
        PmCardStatus.SUPERSEDED,
        PmCardStatus.SKIPPED,
      ].includes(status),
  ),
);

/**
 * Gate layer 2 — dedupe (plan §6). Against open/accepted/shipped cards, rejected cards (with
 * the new-evidence rule), the whole roadmap (every stage, archived included: the agent learns
 * from the roadmap and never re-proposes it) and Bug Hunter findings; and within the batch.
 *
 * A near-duplicate of a REJECTED card passes only when it cites evidence the rejected card did
 * not (a different source/label) — the "stated new evidence delta". A revision is never a
 * duplicate of the card it revises.
 */
export function dedupeGate(
  candidate: PmCandidate,
  corpus: PmDedupeItem[],
  runEvidence: ReadonlyMap<string, PmEvidenceRef>,
  threshold: number = PM_DEDUPE.DUPLICATE_THRESHOLD,
): PmGateVerdict {
  const text = candidateText(candidate);
  for (const item of corpus) {
    if (item.type === 'card' && item.id === candidate.revisedFromCardId) {
      continue;
    }
    if (
      candidate.kind === PmCardKind.QUESTION &&
      item.type === 'card' &&
      item.kind === PmCardKind.QUESTION &&
      candidate.questionKey &&
      item.questionKey === candidate.questionKey &&
      BLOCKING_CARD_STATUSES.has(String(item.status))
    ) {
      return {
        pass: false,
        reasons: [`duplicate: same question as ${item.label}`],
      };
    }
    if (item.type === 'opportunity') {
      const drafted = String(candidate.payload?.opportunity?.description ?? '');
      const same =
        similarity(text, item.text) >= threshold ||
        (drafted.length > 0 &&
          similarity(drafted, item.text) >=
            PM_DEDUPE.ROADMAP_DESCRIPTION_THRESHOLD);
      if (!same) continue;
      return {
        pass: false,
        reasons: [
          item.stage === 'archived'
            ? `duplicate: the roadmap already archived this idea as ${item.label}`
            : `duplicate: already on the roadmap as ${item.label}`,
        ],
      };
    }
    if (similarity(text, item.text) < threshold) continue;
    if (item.type === 'finding') {
      return {
        pass: false,
        reasons: [`duplicate: already a Bug Hunter finding (${item.label})`],
      };
    }
    if (item.status === PmCardStatus.REJECTED) {
      const before = new Set(item.evidenceKeys ?? []);
      const ids: string[] = Array.isArray(candidate.payload?.evidenceIds)
        ? candidate.payload.evidenceIds
        : [];
      const delta = ids.some((id) => {
        const ref = runEvidence.get(id);
        return ref && !before.has(`${ref.source}|${ref.label}`);
      });
      if (!delta) {
        return {
          pass: false,
          reasons: [
            `duplicate: like rejected card ${item.label}, with no new evidence`,
          ],
        };
      }
      continue;
    }
    if (BLOCKING_CARD_STATUSES.has(String(item.status))) {
      return {
        pass: false,
        reasons: [`duplicate: like card ${item.label} (${item.status})`],
      };
    }
  }
  return { pass: true, reasons: [] };
}

/** Within one run: keep the first of any near-identical pair (input order = lane order). */
export function dedupeBatch(
  candidates: PmCandidate[],
  threshold: number = PM_DEDUPE.DUPLICATE_THRESHOLD,
): { kept: PmCandidate[]; dropped: PmCandidate[] } {
  const kept: PmCandidate[] = [];
  const dropped: PmCandidate[] = [];
  for (const candidate of candidates) {
    const text = candidateText(candidate);
    const clash = kept.some(
      (other) =>
        (candidate.questionKey &&
          other.questionKey === candidate.questionKey) ||
        similarity(text, candidateText(other)) >= threshold,
    );
    (clash ? dropped : kept).push(candidate);
  }
  return { kept, dropped };
}
