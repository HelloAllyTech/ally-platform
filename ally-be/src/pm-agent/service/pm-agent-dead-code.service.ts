import { Injectable } from '@nestjs/common';
import { PmAgentSignalRepository } from '../repository/pm-agent.repositories';
import {
  DEAD_CODE_LIMITS,
  DEAD_CODE_SIGNAL_SOURCE,
} from '../constants/pm-agent.constants';
import {
  DeadCodeGroupDto,
  IngestDeadCodeResponseDto,
} from '../dto/pm-agent-dead-code.dto';

const DETECTOR = 'dead_code_scan';

/**
 * Stores the weekly dead-code report as PM Agent evidence, one `pm_agent_signals` row per
 * module. It never files anything itself: the code_health lane reads these rows through the
 * `dead_code_list` tool and may turn a module into a card, and an admin accepting the card is
 * what files the roadmap ticket. Same split as UX Signals: the scan proposes, people decide.
 *
 * One row per (source, key), refreshed in place. A refresh updates the counts and
 * `lastSeenAt` but never `status`, so a module the agent already used or an admin dismissed
 * stays decided. A module that stops appearing is simply not refreshed, and the lane tool
 * ignores rows older than DEAD_CODE_SIGNAL_FRESH_DAYS, so cleaned-up code ages out without
 * anything having to delete or dismiss it.
 */
@Injectable()
export class PmAgentDeadCodeService {
  constructor(private readonly signals: PmAgentSignalRepository) {}

  async ingest(groups: DeadCodeGroupDto[]): Promise<IngestDeadCodeResponseDto> {
    let created = 0;
    let refreshed = 0;
    for (const group of groups) {
      const title = `${group.count} unused ${group.count === 1 ? 'item' : 'items'} in ${group.key}`;
      const metrics = {
        repo: group.repo,
        count: group.count,
        kinds: group.kinds,
        items: group.items.slice(0, DEAD_CODE_LIMITS.ITEMS_MAX),
        windowLabel: 'Weekly dead-code report',
      };
      const rows: { inserted: boolean }[] = await this.signals.query(
        `INSERT INTO "pm_agent_signals"
           ("source", "detector", "key", "title", "summary", "metrics")
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT ("source", "key")
         DO UPDATE SET "title" = EXCLUDED."title", "summary" = EXCLUDED."summary",
                       "metrics" = EXCLUDED."metrics",
                       "lastSeenAt" = now(), "updatedAt" = now()
         RETURNING (xmax = 0) AS inserted`,
        [
          DEAD_CODE_SIGNAL_SOURCE,
          DETECTOR,
          group.key,
          title.slice(0, DEAD_CODE_LIMITS.TITLE_MAX),
          `${title}. ${Object.entries(group.kinds)
            .map(([kind, n]) => `${n} ${kind}`)
            .join(', ')}.`,
          JSON.stringify(metrics),
        ],
      );
      if (rows[0]?.inserted === true) created += 1;
      else refreshed += 1;
    }
    return { received: groups.length, created, refreshed };
  }
}
