import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { AgentTurnStoreService } from 'src/llm-agent/harness/turn/agent-turn-store.service';
import { GUIDE_STALE_TURN_MS } from '../constants/guide.constants';
import {
  ALLY_GUIDE_AGENT_KEY,
  GUIDE_DEFAULT_BUNDLE,
} from '../release/guide-release.bundle';

/**
 * On boot: make sure Ally has a GA release (version 1 from the bundle in
 * code), and mark turns a previous process left open as interrupted so their
 * threads are not blocked (plan §7.10). Never fails the boot — the guide is
 * off by default and the rest of the API must start regardless.
 */
@Injectable()
export class GuideBootstrapService implements OnApplicationBootstrap {
  private readonly logger = LoggerService.getInstance(
    GuideBootstrapService.name,
  );

  constructor(
    private readonly releases: AgentReleaseService,
    private readonly turns: AgentTurnStoreService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const release = await this.releases.ensureSeed(
        ALLY_GUIDE_AGENT_KEY,
        GUIDE_DEFAULT_BUNDLE as unknown as Record<string, unknown>,
      );
      if (release) {
        this.logger.info(`Ally guide GA release: v${release.version}`);
      }
    } catch (error) {
      this.logger.error('Ally guide release seed failed', error);
    }
    try {
      const interrupted =
        await this.turns.markStaleOpenTurnsInterrupted(GUIDE_STALE_TURN_MS);
      if (interrupted) {
        this.logger.warn(`Marked ${interrupted} interrupted agent turn(s)`);
      }
    } catch (error) {
      this.logger.error('Stale agent-turn sweep failed', error);
    }
  }
}
