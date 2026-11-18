import { Injectable, Optional } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  FEATURE_TOGGLES,
  FeatureToggleKey,
} from 'src/authorization/constants/admin-feature-toggle.constants';
import { BuilderRepoMap } from '../entity/builder-repo-map.entity';
import { BuilderRepoMapRepository } from '../repository/builder-knowledge.repository';
import { BuilderLessonCategory } from '../enum/builder.enum';
import { ClCollectionId } from 'src/context-library/enum/context-library.enum';
import { ContextAgentChunkService } from 'src/context-library/service/context-agent-chunk.service';
import { BUILDER_REPOS } from '../constants/builder-repos.constants';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { loadPlatformRules } from '../constants/builder-platform-rules';

/** How long a looked-up rules text is reused before asking again. */
const PLATFORM_RULES_TTL_MS = 60_000;

/**
 * The agent's standing knowledge of Ally: Repo Knowledge Packs and the feature
 * registry, plus the lessons block `BuilderLessonsService` renders from the
 * Context Library's Builder Lessons collection.
 *
 * This is the cheap half of "codebase-aware". The maps and lessons are
 * assembled once per turn into a stable prefix that Anthropic prompt-caching
 * can hold, so a twenty-turn interview pays full price for this context once
 * rather than twenty times. Live GitHub reads are the expensive half and are
 * reserved for following up on what the maps point at.
 */
@Injectable()
export class BuilderKnowledgeService {
  private readonly logger = LoggerService.getInstance(
    BuilderKnowledgeService.name,
  );

  private platformRulesCache: { text: string; expiresAt: number } | null = null;

  constructor(
    private readonly repoMapRepository: BuilderRepoMapRepository,
    // Optional so a context without prompt management (a unit test, a script)
    // still gets the compiled rules rather than failing to construct.
    @Optional() private readonly promptSharedService?: PromptSharedService,
    /** Where lessons are written. Optional, like the prompts, for fixtures. */
    @Optional() private readonly agentChunks?: ContextAgentChunkService,
  ) {}

  /**
   * The platform rules every Builder agent gets — the interviewer, the
   * research pass and every runner phase read them through here, so one edit
   * in prompt management reaches all of them.
   *
   * Memoised for a minute: the interviewer asks on every turn and the runner
   * on every phase, for text that changes when a person edits a prompt.
   * Never empty — see loadPlatformRules.
   */
  async platformRules(): Promise<string> {
    const now = Date.now();
    if (this.platformRulesCache && this.platformRulesCache.expiresAt > now) {
      return this.platformRulesCache.text;
    }
    const text = await loadPlatformRules(this.promptSharedService);
    this.platformRulesCache = {
      text,
      expiresAt: now + PLATFORM_RULES_TTL_MS,
    };
    return text;
  }

  /**
   * The cacheable context block: what each repo is, what we know about its
   * insides, and what previous builds learned (`lessons`, already rendered by
   * `BuilderLessonsService` — frozen per session, so the block stays a stable
   * prefix).
   *
   * Returns markdown rather than JSON because it is read by a model, not
   * parsed — and because a map is prose to begin with.
   */
  async buildContextBlock(
    repos?: string[],
    /**
     * Digests of similar past builds. Passed in rather than fetched here so
     * the caller controls when a re-rank call is worth making — this block is
     * assembled on every turn, and the exemplar set changes far more slowly
     * than that.
     */
    exemplars: string[] = [],
    lessons = '',
  ): Promise<string> {
    const maps = await this.repoMapRepository.listAll();

    const parts: string[] = [];

    parts.push('# Ally platform — repositories\n');
    for (const repo of BUILDER_REPOS) {
      parts.push(`- **${repo.repo}** — ${repo.description}`);
    }

    const mapsByRepo = new Map(maps.map((map) => [map.repo, map]));
    const relevantMaps = repos?.length
      ? repos.map((repo) => mapsByRepo.get(repo)).filter(Boolean)
      : maps;

    if (relevantMaps.length) {
      parts.push('\n# Repo knowledge packs\n');
      for (const map of relevantMaps as BuilderRepoMap[]) {
        parts.push(
          `\n## ${map.repo}${
            map.commitSha ? ` (at ${map.commitSha.slice(0, 7)})` : ''
          }\n\n${map.mapMd}`,
        );
      }
    } else {
      // Say it plainly rather than letting the agent infer the repos are
      // empty: no map means "look it up", not "there is nothing there".
      parts.push(
        '\n# Repo knowledge packs\n\nNone generated yet. Use the github_* tools to ' +
          'explore before making claims about how anything is built.',
      );
    }

    parts.push('\n# Platform feature registry\n');
    parts.push(
      'Admin surfaces are gated by these feature-toggle keys (a new admin ' +
        'surface needs one):\n',
    );
    for (const toggle of FEATURE_TOGGLES) {
      parts.push(
        `- \`${toggle.key}\` — ${toggle.label}: ${toggle.description}`,
      );
    }

    if (lessons.trim()) {
      parts.push(`\n${lessons}`);
    }

    if (exemplars.length) {
      parts.push('\n# Similar builds this platform has already attempted\n');
      parts.push(
        'What happened *after* each shipped is the useful part — a rejected ' +
          'approach is worth more here than a successful one.\n',
      );
      for (const exemplar of exemplars) {
        parts.push(`\n${exemplar}`);
      }
    }

    return parts.join('\n');
  }

  /** Feature-toggle keys, for validating what a PRD proposes to gate on. */
  listFeatureToggleKeys(): FeatureToggleKey[] {
    return FEATURE_TOGGLES.map((toggle) => toggle.key);
  }

  /**
   * Just the repo knowledge packs, for the build phases.
   *
   * The interview has had these since the module was written; the planner and
   * coder never did, so every build phase rediscovered repo structure by
   * reading files. On the first real build the planner spent $7.85 and 19
   * minutes largely doing that.
   *
   * Rendered separately from `buildContextBlock` rather than reusing it because
   * the build phases have no use for the feature-toggle registry that block
   * also carries, and a prompt prefix is not the place for tokens nobody reads.
   */
  async renderRepoPacks(repos?: string[]): Promise<string> {
    const maps = await this.repoMapRepository.listAll();
    const byRepo = new Map(maps.map((map) => [map.repo, map]));
    const relevant = (
      repos?.length
        ? repos.map((repo) => byRepo.get(repo)).filter(Boolean)
        : maps
    ) as BuilderRepoMap[];

    if (!relevant.length) return '';

    const parts = ['# Repo knowledge packs\n'];
    for (const map of relevant) {
      parts.push(
        `\n## ${map.repo}${
          map.commitSha ? ` (at ${map.commitSha.slice(0, 7)})` : ''
        }\n\n${map.mapMd}`,
      );
    }
    return parts.join('\n');
  }

  /**
   * Record a lesson as a **candidate** in the Context Library's Builder Lessons
   * collection, for the agent curator to place.
   *
   * Candidates are not fed to prompts. That is the whole point: raw
   * retrospective bullets used to go straight into the set every future run
   * read, so the same trap learned five times became five rows competing for
   * one fixed context budget. Best-effort: losing one lesson must never fail
   * the outcome or correction pass that found it.
   */
  async recordLesson(params: {
    sessionId?: string | null;
    /** @deprecated pass `repos` — a single repo loses multi-repo attribution. */
    repo?: string | null;
    repos?: string[] | null;
    category: BuilderLessonCategory;
    lesson: string;
    createdBy?: number;
  }): Promise<void> {
    const text = params.lesson?.trim();
    if (!text || !this.agentChunks) return;

    // A two-repo build used to lose its attribution entirely and become
    // platform-wide, because only a single-repo build had a `repo` to record.
    const repos = params.repos?.length
      ? params.repos
      : params.repo
        ? [params.repo]
        : null;

    try {
      await this.agentChunks.writeAgentChunk({
        collection: ClCollectionId.BUILDER_LESSONS,
        agent: 'builder',
        statement: text,
        facets: { category: params.category },
        repos,
        evidence: { sessionId: params.sessionId ?? null },
        createdBy: params.createdBy ?? null,
      });
    } catch (error) {
      this.logger.warn(
        `A Builder lesson could not be written: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Repo maps with their staleness, for the settings view. */
  listRepoMaps(): Promise<BuilderRepoMap[]> {
    return this.repoMapRepository.listAll();
  }

  /** Upsert from the context-refresh workflow — one row per repo. */
  async upsertRepoMap(params: {
    repo: string;
    mapMd: string;
    commitSha?: string | null;
    stats?: Record<string, any> | null;
  }): Promise<BuilderRepoMap> {
    const existing = await this.repoMapRepository.findByRepo(params.repo);
    const payload = {
      repo: params.repo,
      mapMd: params.mapMd,
      commitSha: params.commitSha ?? null,
      stats: params.stats ?? null,
      generatedAt: new Date(),
    };
    if (existing) {
      await this.repoMapRepository.update({ id: existing.id }, payload);
      return this.repoMapRepository.findOneOrFail({
        where: { id: existing.id },
      });
    }
    return this.repoMapRepository.save(this.repoMapRepository.create(payload));
  }
}
