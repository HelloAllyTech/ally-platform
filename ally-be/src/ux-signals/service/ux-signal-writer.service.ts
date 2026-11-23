import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';

import { LoggerService } from 'src/logger/logger.service';
import { BugHunterBoardService } from 'src/bug-hunter-approvals/service/bug-hunter-board.service';
import { PmAgentSignal } from 'src/pm-agent/entity/pm-agent-signal.entity';

import {
  UX_SIGNAL_FIELD_LIMITS,
  UX_SIGNAL_REPO,
} from '../constants/ux-signals.constants';
import { UxSignalKind } from '../enum/ux-signal.enum';
import { TriagedItem } from '../ux-signals.types';

/** `pm_agent_signals.source` for everything this module files. */
export const UX_SIGNALS_SOURCE = 'ux_signals';
/** `pm_agent_signals.detector` for triaged improvement items (bugs go to bug_findings). */
const TRIAGE_DETECTOR = 'ux_triage';

/** What one write pass filed, and what it recognised as already known. */
export interface WriteResult {
  findingsCreated: number;
  suggestionsCreated: number;
  skippedDuplicates: number;
}

/**
 * Files triaged items: bugs into the Bug Hunter queue, improvements into the PM Agent's
 * signal store.
 *
 * This service writes to `bug_findings` and `pm_agent_signals` through raw
 * repositories rather than by importing BugHunterModule or PmAgentModule. That is the established cross-domain pattern here
 * (see RoadmapOpportunityService.create, which inserts a bug finding the same
 * way) and it exists to avoid the circular-import DI traps that bit this codebase
 * before: a module graph where every producer of findings depends on the module
 * that consumes them does not stay acyclic for long.
 *
 * Nothing here dispatches work. A bug lands at NEW for an admin to approve, and an
 * improvement lands as a `new` signal the PM Agent may turn into a card — the
 * agent's own gates decide what happens next, and no code path in this pipeline
 * can start a fix session or open a pull request. The scan proposes; people decide.
 */
@Injectable()
export class UxSignalWriterService {
  private readonly logger = LoggerService.getInstance(
    UxSignalWriterService.name,
  );

  constructor(
    private readonly bugHunter: BugHunterBoardService,
    @InjectRepository(PmAgentSignal)
    private readonly signalRepository: Repository<PmAgentSignal>,
  ) {}

  /**
   * File every item, then report what landed.
   *
   * Each item is written independently and best-effort: one malformed row must not
   * discard the rest of a scan's work. There is no transaction spanning the two
   * tables on purpose — a bug finding and a signal are separate artefacts for
   * separate consumers, and rolling one back because the other failed would lose real
   * information to preserve a consistency nobody reads.
   */
  async write(
    items: TriagedItem[],
    scan: { windowFrom: string; windowTo: string; model: string },
  ): Promise<WriteResult> {
    const result: WriteResult = {
      findingsCreated: 0,
      suggestionsCreated: 0,
      skippedDuplicates: 0,
    };

    for (const item of items) {
      try {
        const filed =
          item.kind === UxSignalKind.BUG
            ? await this.fileBug(item)
            : await this.fileSignal(item, scan);

        if (!filed) {
          result.skippedDuplicates += 1;
        } else if (item.kind === UxSignalKind.BUG) {
          result.findingsCreated += 1;
        } else {
          result.suggestionsCreated += 1;
        }
      } catch (error) {
        this.logger.warn(
          `[UX-SIGNALS] Failed to file ${item.kind} "${item.title}": ${String(error)}`,
        );
      }
    }

    return result;
  }

  /**
   * One bug finding, or false when this bug is already open.
   *
   * The dedupe key is built with the route/target as `symbol`, which is the whole
   * reason UX findings dedupe reliably. A UX signal has no `file` — its coordinate
   * is a route, not a code location — and without a symbol the key would fall back
   * to a fuzzy fingerprint of LLM-written prose. That fallback is exactly what made
   * the nightly sweep manufacture duplicate rows before, and a scan that re-files
   * the same rage-click cluster every day would do it faster.
   *
   * `repo` is set outright rather than left to the repo classifier: every event a
   * detector reads is emitted by the helpline frontend, so the answer is known from
   * the provenance of the data and an LLM guess could only be wrong. It also has to
   * be present for the drawer's fix-session button to work at all.
   *
   * `proven` stays false. These findings never pass through the sweep's adversarial
   * verify phase, and claiming a verification that did not happen would misrepresent
   * them to the admin deciding whether to act.
   */
  private async fileBug(item: TriagedItem): Promise<boolean> {
    const symbol = item.target ? `${item.route}|${item.target}` : item.route;
    const description = item.body.slice(
      UX_SIGNAL_FIELD_LIMITS.DESCRIPTION * -1,
    );
    // The old Bug Hunter's identity, unchanged: one bug per route/target, whatever the
    // wording (the model rewords freely between runs).
    const norm = (v: string) => v.toLowerCase().replace(/\s+/g, ' ').trim();
    const key = createHash('sha256')
      .update(`::ux_signal::${norm(symbol)}`)
      .digest('hex');
    return this.bugHunter.enqueueSignal({
      source: 'ux_signal',
      key,
      app: UX_SIGNAL_REPO,
      title: item.title.slice(0, UX_SIGNAL_FIELD_LIMITS.TITLE),
      description: `${description}\n\n${this.formatEvidence(item)}`,
      severity: item.severity,
      symbol,
    });
  }

  /**
   * One improvement signal, or false when an equivalent one is already stored.
   *
   * Stored in `pm_agent_signals`, one row per (source, key), where the key is a
   * fingerprint of route + target + normalised title. The insert is a single
   * `ON CONFLICT (source, key)` statement, so two overlapping passes cannot file
   * the same card twice (the unique constraint is the lock) and no advisory lock
   * is needed. On a conflict only `lastSeenAt` moves: a signal the PM Agent has
   * used or an admin dismissed keeps its status, so a dismissal is a standing
   * decision rather than something the next scan quietly reverses. `xmax = 0`
   * distinguishes a fresh insert from a refresh.
   */
  private async fileSignal(
    item: TriagedItem,
    scan: { windowFrom: string; windowTo: string; model: string },
  ): Promise<boolean> {
    const title = item.title.slice(0, UX_SIGNAL_FIELD_LIMITS.TITLE);
    const key = UxSignalWriterService.signalKey(item);
    const metrics = {
      route: item.route,
      target: item.target ?? null,
      kind: item.kind,
      body: item.body.slice(0, UX_SIGNAL_FIELD_LIMITS.BODY),
      rationale: item.rationale.slice(0, UX_SIGNAL_FIELD_LIMITS.RATIONALE),
      evidence: item.evidence
        .slice(0, UX_SIGNAL_FIELD_LIMITS.EVIDENCE_ITEMS)
        .map((line) => line.slice(0, UX_SIGNAL_FIELD_LIMITS.EVIDENCE_ITEM)),
      suggestedGoal: item.suggestedGoal,
      confidence: item.confidence ?? null,
      windowFrom: scan.windowFrom,
      windowTo: scan.windowTo,
      windowLabel: `UX scan · ${scan.windowFrom} → ${scan.windowTo}`,
      model: scan.model,
    };

    const rows: { inserted: boolean }[] = await this.signalRepository.query(
      `INSERT INTO "pm_agent_signals"
         ("source", "detector", "key", "title", "summary", "metrics", "severity")
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT ("source", "key")
       DO UPDATE SET "lastSeenAt" = now(), "updatedAt" = now()
       RETURNING (xmax = 0) AS inserted`,
      [
        UX_SIGNALS_SOURCE,
        TRIAGE_DETECTOR,
        key,
        title,
        metrics.body,
        JSON.stringify(metrics),
        item.severity,
      ],
    );
    return rows[0]?.inserted === true;
  }

  /** Stable dedupe key: the coordinate plus a hash of the normalised title. */
  static signalKey(item: TriagedItem): string {
    const coordinate = item.target
      ? `${item.route}|${item.target}`
      : item.route;
    const hash = createHash('sha1')
      .update(item.title.toLowerCase().replace(/\s+/g, ' ').trim())
      .digest('hex')
      .slice(0, 16);
    return `${coordinate.slice(0, 130)}#${hash}`;
  }

  /**
   * Evidence as text, because `bug_findings.evidence` is a text column shared with
   * finders that paste raw test output into it. The route and the model's own
   * confidence go in here too: they are provenance for the admin reading the
   * drawer, and a finding that hides how sure the pipeline was invites more trust
   * than it earned.
   */
  private formatEvidence(item: TriagedItem): string {
    const lines = [
      `Route: ${item.route}`,
      item.target ? `Target: ${item.target}` : null,
      'Source: UX Signals scan over PostHog telemetry (no code inspection).',
      item.confidence ? `Confidence: ${item.confidence}` : null,
      '',
      ...item.evidence
        .slice(0, UX_SIGNAL_FIELD_LIMITS.EVIDENCE_ITEMS)
        .map(
          (line) => `- ${line.slice(0, UX_SIGNAL_FIELD_LIMITS.EVIDENCE_ITEM)}`,
        ),
    ];
    return lines.filter((line) => line !== null).join('\n');
  }
}
