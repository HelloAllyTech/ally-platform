import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { LoggerService } from 'src/logger/logger.service';
import { PmSignalStatus } from '../enum/pm-agent.enum';
import { PmAgentSignalRepository } from '../repository/pm-agent.repositories';
import type {
  IngestSecuritySignalsResult,
  SecuritySignalFindingDto,
} from '../dto/pm-security-signal.dto';

/** `pm_agent_signals.source` for security audit findings. */
export const SECURITY_AUDIT_SOURCE = 'security_audit';
const DETECTOR = 'security_audit_review';
/** LOW stays in the private GitHub issue; the card feed only gets these. */
const FILED = new Set(['critical', 'high', 'medium']);

const normalise = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Same service + file + title is the same problem next week, whatever the line number. */
export function securitySignalKey(f: SecuritySignalFindingDto): string {
  const digest = createHash('sha1')
    .update(`${f.service}|${f.file}|${normalise(f.title)}`)
    .digest('hex')
    .slice(0, 40);
  return `sec:${f.service}:${digest}`.slice(0, 160);
}

/**
 * Files security audit findings as PM Agent evidence. Writes only `pm_agent_signals`; it
 * never creates a card or a roadmap item — the agent's own gates and an admin's accept do.
 * One row per (source, key), refreshed in place; a dismissal is a standing decision and is
 * never reopened.
 */
@Injectable()
export class PmSecuritySignalService {
  private readonly logger = LoggerService.getInstance(
    PmSecuritySignalService.name,
  );

  constructor(private readonly signals: PmAgentSignalRepository) {}

  async ingest(
    findings: SecuritySignalFindingDto[],
    runUrl?: string,
  ): Promise<IngestSecuritySignalsResult> {
    const result: IngestSecuritySignalsResult = {
      created: 0,
      refreshed: 0,
      skippedDismissed: 0,
      skippedLowSeverity: 0,
    };
    for (const f of findings) {
      if (!FILED.has(f.severity)) {
        result.skippedLowSeverity += 1;
        continue;
      }
      try {
        const key = securitySignalKey(f);
        const summary = [f.what, f.impact && `Impact: ${f.impact}`]
          .filter(Boolean)
          .join(' ')
          .slice(0, 3000);
        const metrics = {
          service: f.service,
          file: f.file,
          line: f.line ?? null,
          fix: f.fix ?? null,
          runUrl: runUrl ?? null,
        };
        const existing = await this.signals.findOne({
          where: { source: SECURITY_AUDIT_SOURCE, key },
        });
        if (existing) {
          if (existing.status === PmSignalStatus.DISMISSED) {
            result.skippedDismissed += 1;
            continue;
          }
          existing.title = f.title;
          existing.summary = summary;
          existing.severity = f.severity;
          existing.metrics = metrics;
          existing.lastSeenAt = new Date();
          await this.signals.save(existing);
          result.refreshed += 1;
        } else {
          await this.signals.save(
            this.signals.create({
              source: SECURITY_AUDIT_SOURCE,
              detector: DETECTOR,
              key,
              title: f.title,
              summary,
              metrics,
              severity: f.severity,
              status: PmSignalStatus.NEW,
            }),
          );
          result.created += 1;
        }
      } catch (error) {
        this.logger.warn(
          `[PM_AGENT] Failed to file security signal "${f.title}": ${String(error)}`,
        );
      }
    }
    return result;
  }
}
