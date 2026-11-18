import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderRule } from '../entity/builder-rule.entity';

@Injectable()
export class BuilderRuleRepository extends Repository<BuilderRule> {
  constructor(dataSource: DataSource) {
    super(BuilderRule, dataSource.createEntityManager());
  }
}

const RULES_IN_CONTEXT = 30;

/**
 * The person's guide rules, as the interview and every run read them.
 *
 * Its own service, with nothing but the repository, so the interview
 * orchestrator can read rules without depending on BuilderRulesService —
 * which depends on the decision service, which depends on the orchestrator.
 */
@Injectable()
export class BuilderRuleContextService {
  private readonly logger = LoggerService.getInstance(
    BuilderRuleContextService.name,
  );

  constructor(
    private readonly repository: BuilderRuleRepository,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Active guide rules that bind this session. Area rules are all included,
   * labelled with their area: a session is not classified into one, and the
   * model is better at telling whether "learner reminders" applies than a
   * column would be.
   */
  async rulesInScope(sessionId: string): Promise<BuilderRule[]> {
    const opportunityId = await this.opportunityOf(sessionId);
    const scopes = ['everywhere', `session:${sessionId}`];
    if (opportunityId) scopes.push(`opportunity:${opportunityId}`);
    const rules = await this.repository.find({
      where: { active: true, effect: 'guide' },
      order: { createdAt: 'DESC' },
    });
    return rules
      .filter(
        (rule) => scopes.includes(rule.scope) || rule.scope.startsWith('area:'),
      )
      .slice(0, RULES_IN_CONTEXT);
  }

  /** The rules block for a prompt, or '' when there are none or they can't be read. */
  async renderRulesBlock(sessionId: string): Promise<string> {
    try {
      const rules = await this.rulesInScope(sessionId);
      if (!rules.length) return '';
      return [
        "## The admin's rules",
        'Decided once by the admin; they outrank your lessons and your own preferences. ' +
          'When a rule answers a question you would ask, do not ask it: apply the rule and ' +
          'record it in the PRD as an assumption citing the rule ("Applied your rule: …"), ' +
          'which the admin can overturn.',
        ...rules.map((rule) => `- [${rule.area}] ${rule.statement}`),
      ].join('\n');
    } catch (error) {
      this.logger.warn(
        `Could not read Builder rules for ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return '';
    }
  }

  /** A read of the roadmap's table, not an import of its module (see BuilderNowService). */
  private async opportunityOf(sessionId: string): Promise<string | null> {
    try {
      const rows: { id: string }[] = await this.dataSource.query(
        `SELECT id FROM roadmap_opportunities WHERE "builderSessionId" = $1 LIMIT 1`,
        [sessionId],
      );
      return rows[0]?.id ?? null;
    } catch {
      return null;
    }
  }
}
