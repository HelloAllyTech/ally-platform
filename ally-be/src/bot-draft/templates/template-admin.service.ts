import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { READY_MADE } from '../../chatbot/lists/ready-made-lists';
import { TEMPLATE_LISTS } from '../../chatbot/templates/template-lists';
import {
  TEMPLATE_KEY_PATTERN,
  TEMPLATE_LIMITS,
  validateTemplate,
  type TemplateIssue,
} from '../../chatbot/templates/template-validation';
import {
  TEMPLATE_GROUPS,
  TEMPLATES,
  type UseCaseTemplate,
} from '../../chatbot/templates/templates';
import { LoggerService } from '../../logger/logger.service';
import { AssistantTemplate } from '../entity/assistant-template.entity';
import { PurposeId, SafetyPackId } from '../enum/bot-draft.enum';
import { SAFETY_PACKS } from '../safety-pack/safety-packs';
import { TemplateRegistryService } from './template-registry.service';

/** Every key a manifest may carry; anything else a client sends is dropped on save. */
const MANIFEST_KEYS = [
  'id',
  'group',
  'name',
  'one_liner',
  'for',
  'icon',
  'purpose',
  'pack',
  'hand_over',
  'memory',
  'memory_notice',
  'organisation_only',
  'instructions',
  'lists',
  'setup',
  'checkups',
  'suggested_for',
] as const;

/** A manifest is a few KB; this only stops someone saving a book. */
const MAX_MANIFEST_BYTES = 200_000;

export type TemplateState =
  /** A built-in, nothing changed. */
  | 'built_in'
  /** A built-in with a published version replacing it. */
  | 'overridden'
  /** A staff-made template, live. */
  | 'published'
  /** A staff-made template not live (never published, or taken down). */
  | 'unpublished';

export interface TemplateRow {
  key: string;
  name: string;
  group: string;
  one_liner: string;
  icon: string;
  /** `built_in`: the key is a built-in's. `custom`: staff made it. */
  origin: 'built_in' | 'custom';
  state: TemplateState;
  live_version: number | null;
  draft_version: number | null;
  /** Assistants set up from this template, any version. */
  installs: number;
  updated_at: string | null;
}

export interface VersionView {
  id: string;
  version: number;
  status: AssistantTemplate['status'];
  note: string | null;
  created_at: string;
  published_at: string | null;
  retired_at: string | null;
}

const iso = (d?: Date | null) => (d ? d.toISOString() : null);

const view = (r: AssistantTemplate): VersionView => ({
  id: r.id,
  version: r.version,
  status: r.status,
  note: r.note ?? null,
  created_at: iso(r.createdAt)!,
  published_at: iso(r.publishedAt),
  retired_at: iso(r.retiredAt),
});

const userId = () => Number(ExecutionManager.getUserId() ?? 0) || null;

/** The starting point of a template made from nothing. It fails validation until it is filled in. */
export const blankTemplate = (key: string, name: string): UseCaseTemplate => ({
  id: key,
  group: 'businesses',
  name,
  one_liner: '',
  for: '',
  icon: '✨',
  purpose: PurposeId.ANSWER,
  pack: null,
  hand_over: false,
  memory: false,
  instructions: `You are the assistant for {name}. Answer from what {name} has told you, and say so when you don't know.`,
  lists: [],
  setup: [],
  checkups: [],
  suggested_for: [],
});

/**
 * Assistants admin → Templates: staff build, version and publish the use-case templates.
 *
 * A template's life: a **draft** (one open at a time, edited freely and saved as often as staff
 * like, never seen by owners) → **published** (the catalogue serves it, replacing a built-in of
 * the same key or adding a new template; its manifest never changes again) → **retired** when a
 * newer version is published or staff take it down. Publishing needs `validateTemplate` to find no
 * errors. Assistants already set up from a template never change when it does.
 */
@Injectable()
export class TemplateAdminService {
  private readonly logger = LoggerService.getInstance(
    TemplateAdminService.name,
  );

  constructor(
    @InjectRepository(AssistantTemplate)
    private readonly rows: Repository<AssistantTemplate>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly registry: TemplateRegistryService,
  ) {}

  // ---- reading ---------------------------------------------------------------------------------

  /** Every template, built-in or staff-made, as one row each. */
  async list(): Promise<{ templates: TemplateRow[] }> {
    const [all, installs] = await Promise.all([
      this.rows.find({ order: { version: 'DESC' } }),
      this.installCounts(),
    ]);
    const byKey = new Map<string, AssistantTemplate[]>();
    for (const r of all) {
      byKey.set(r.templateKey, [...(byKey.get(r.templateKey) ?? []), r]);
    }
    const builtIn = new Map(TEMPLATES.map((t) => [t.id, t]));
    const keys = [
      ...TEMPLATES.map((t) => t.id),
      ...[...byKey.keys()].filter((k) => !builtIn.has(k)),
    ];
    const templates = keys.map((key): TemplateRow => {
      const versions = byKey.get(key) ?? [];
      const live = versions.find((v) => v.status === 'published');
      const draft = versions.find((v) => v.status === 'draft');
      const code = builtIn.get(key);
      const shown = live?.manifest ?? draft?.manifest ?? code!;
      const latest = versions.reduce<Date | null>(
        (a, v) => (!a || v.updatedAt > a ? v.updatedAt : a),
        null,
      );
      return {
        key,
        name: shown.name,
        group: shown.group,
        one_liner: shown.one_liner,
        icon: shown.icon,
        origin: code ? 'built_in' : 'custom',
        state: code
          ? live
            ? 'overridden'
            : 'built_in'
          : live
            ? 'published'
            : 'unpublished',
        live_version: live?.version ?? null,
        draft_version: draft?.version ?? null,
        installs: installs.get(key) ?? 0,
        updated_at: iso(latest),
      };
    });
    return { templates };
  }

  /** One template: what's live, the open draft with its problems, and every version. */
  async get(key: string) {
    const code = TEMPLATES.find((t) => t.id === key) ?? null;
    const versions = await this.rows.find({
      where: { templateKey: key },
      order: { version: 'DESC' },
    });
    if (!code && !versions.length) throw this.notFound();
    const live = versions.find((v) => v.status === 'published') ?? null;
    const draft = versions.find((v) => v.status === 'draft') ?? null;
    const installs = (await this.installCounts()).get(key) ?? 0;
    return {
      key,
      origin: code ? 'built_in' : 'custom',
      built_in: code,
      live: live ? { ...view(live), manifest: live.manifest } : null,
      draft: draft
        ? {
            ...view(draft),
            manifest: draft.manifest,
            issues: validateTemplate(draft.manifest),
          }
        : null,
      versions: versions.map(view),
      installs,
    };
  }

  /** One stored version's manifest, for "view" and "restore". */
  async getVersion(key: string, version: number) {
    const row = await this.rows.findOne({
      where: { templateKey: key, version },
    });
    if (!row) throw this.notFound();
    return { ...view(row), manifest: row.manifest };
  }

  /** What the editor offers: lists, packs, purposes, groups and the size rules. */
  meta() {
    const lists = [
      ...READY_MADE.flatMap((i) => i.lists),
      ...TEMPLATE_LISTS,
    ].map((l) => ({
      key: l.key,
      name: l.name,
      fields: l.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        agent_write: Boolean(f.agent_write),
        example_options: Boolean(f.example_options),
        to: (f.options?.to as string | undefined) ?? null,
      })),
    }));
    return {
      lists,
      packs: Object.values(SafetyPackId).map((id) => ({
        id,
        name: SAFETY_PACKS[id].curatorName ?? SAFETY_PACKS[id].name,
      })),
      purposes: [
        { id: PurposeId.ANSWER, name: 'Answers questions' },
        { id: PurposeId.ENQUIRIES, name: 'Takes enquiries' },
        { id: PurposeId.TRAINING, name: 'Trains a team' },
        { id: PurposeId.GUIDE, name: 'Guides people' },
        { id: PurposeId.CUSTOM, name: 'Something else' },
      ],
      groups: TEMPLATE_GROUPS,
      limits: TEMPLATE_LIMITS,
      key_pattern: TEMPLATE_KEY_PATTERN.source,
    };
  }

  // ---- drafts ----------------------------------------------------------------------------------

  /**
   * Starts a draft. With `from`, it begins as a copy of that template (a built-in's code, or a
   * stored version): under the same key it will replace that template once published; under a new
   * key it is a new template. With nothing, it begins blank under a new key.
   */
  async createDraft(input: {
    key: string;
    name?: string;
    from?: { key: string; version?: number };
  }) {
    const key = input.key.trim();
    if (!TEMPLATE_KEY_PATTERN.test(key)) {
      throw new BadRequestException({
        errorCode: 'template_key_invalid',
        message:
          'The key is lowercase letters, numbers and underscores, starting with a letter.',
      });
    }
    let seed: UseCaseTemplate;
    if (input.from) {
      seed = await this.sourceManifest(input.from.key, input.from.version);
    } else {
      if (!input.name?.trim()) {
        throw new BadRequestException('Give the template a name.');
      }
      seed = blankTemplate(key, input.name.trim());
    }
    const manifest = {
      ...structuredClone(seed),
      id: key,
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    };
    return this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(AssistantTemplate);
      // Serialise per key so two staff starting a draft can't both pass the open-draft check.
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `assistant_template:${key}`,
      ]);
      const existing = await repo.find({ where: { templateKey: key } });
      // A key already in use (built-in, or with versions) is only for that template's own lineage:
      // editing a built-in, or restoring one of its versions. Copying another template needs a new key.
      if (
        input.from?.key !== key &&
        (existing.length || TEMPLATES.some((t) => t.id === key))
      ) {
        throw new ConflictException({
          errorCode: 'template_key_taken',
          message: 'A template already uses that key.',
        });
      }
      if (existing.some((r) => r.status === 'draft')) {
        throw new ConflictException({
          errorCode: 'draft_exists',
          message: 'This template already has an open draft.',
        });
      }
      const version = existing.reduce((n, r) => Math.max(n, r.version), 0) + 1;
      const row = await repo.save(
        repo.create({
          templateKey: key,
          version,
          status: 'draft',
          manifest,
          note: input.from ? `Started from ${input.from.key}` : null,
          createdBy: userId(),
        }),
      );
      this.logger.info(`Template draft ${key} v${version} created`);
      return {
        ...view(row),
        manifest: row.manifest,
        issues: validateTemplate(manifest),
      };
    });
  }

  /** Saves the open draft. Problems are returned, never refused: a draft may be half-finished. */
  async saveDraft(key: string, body: unknown, note?: string | null) {
    const draft = await this.openDraft(key);
    const manifest = this.clean(key, body);
    draft.manifest = manifest;
    draft.updatedAt = new Date();
    if (note !== undefined) draft.note = note?.trim() || null;
    const saved = await this.rows.save(draft);
    return {
      ...view(saved),
      manifest: saved.manifest,
      issues: validateTemplate(manifest),
    };
  }

  async discardDraft(key: string): Promise<{ ok: true }> {
    const draft = await this.openDraft(key);
    await this.rows.delete({ id: draft.id });
    return { ok: true };
  }

  // ---- publishing ------------------------------------------------------------------------------

  /** Makes the open draft the live version, retiring the one it replaces. */
  async publish(key: string, note?: string | null) {
    const result = await this.dataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `assistant_template:${key}`,
      ]);
      const repo = m.getRepository(AssistantTemplate);
      const draft = await repo.findOne({
        where: { templateKey: key, status: 'draft' },
      });
      if (!draft) {
        throw new NotFoundException({
          errorCode: 'no_draft',
          message: 'There’s no draft to publish.',
        });
      }
      const issues = validateTemplate(draft.manifest);
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length) {
        throw new BadRequestException({
          errorCode: 'template_not_ready',
          message: `This can’t be published yet: ${errors.length} ${errors.length === 1 ? 'problem' : 'problems'} to fix.`,
          issues,
        });
      }
      const now = new Date();
      // Retire first: only one published version per key may exist at any moment.
      await repo.update(
        { templateKey: key, status: 'published' },
        { status: 'retired', retiredAt: now, updatedAt: now },
      );
      draft.status = 'published';
      draft.publishedAt = now;
      draft.publishedBy = userId();
      draft.updatedAt = now;
      if (note !== undefined) draft.note = note?.trim() || draft.note;
      return { row: await repo.save(draft), issues };
    });
    this.registry.invalidate();
    this.logger.info(`Template ${key} v${result.row.version} published`);
    return { ...view(result.row), issues: result.issues };
  }

  /**
   * Takes the live version down. A built-in comes back as it is in code; a staff-made template
   * leaves the catalogue. Assistants already set up from it keep working.
   */
  async unpublish(key: string) {
    const live = await this.rows.findOne({
      where: { templateKey: key, status: 'published' },
    });
    if (!live) {
      throw new NotFoundException({
        errorCode: 'not_published',
        message: 'That template isn’t published.',
      });
    }
    const now = new Date();
    live.status = 'retired';
    live.retiredAt = now;
    live.updatedAt = now;
    await this.rows.save(live);
    this.registry.invalidate();
    this.logger.info(`Template ${key} v${live.version} unpublished`);
    return { ...view(live) };
  }

  /** Copies an older version into a new draft, ready to publish again. */
  async restore(key: string, version: number) {
    return this.createDraft({ key, from: { key, version } });
  }

  // ---- helpers ---------------------------------------------------------------------------------

  private async sourceManifest(
    key: string,
    version?: number,
  ): Promise<UseCaseTemplate> {
    if (version !== undefined) {
      const row = await this.rows.findOne({
        where: { templateKey: key, version },
      });
      if (!row) throw this.notFound();
      return row.manifest;
    }
    // The live version if there is one (so "duplicate" copies what owners see), else the code.
    const live = await this.rows.findOne({
      where: { templateKey: key, status: 'published' },
    });
    const found = live?.manifest ?? TEMPLATES.find((t) => t.id === key);
    if (!found) throw this.notFound();
    return found;
  }

  private async openDraft(key: string): Promise<AssistantTemplate> {
    const draft = await this.rows.findOne({
      where: { templateKey: key, status: 'draft' },
    });
    if (!draft) {
      throw new NotFoundException({
        errorCode: 'no_draft',
        message: 'There’s no open draft for that template.',
      });
    }
    return draft;
  }

  /** Only the manifest's own fields, with the key forced to the template's. */
  private clean(key: string, body: unknown): UseCaseTemplate {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('The template is empty.');
    }
    if (JSON.stringify(body).length > MAX_MANIFEST_BYTES) {
      throw new BadRequestException('That template is too large.');
    }
    const source = body as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of MANIFEST_KEYS) if (k in source) out[k] = source[k];
    out.id = key;
    return out as unknown as UseCaseTemplate;
  }

  private async installCounts(): Promise<Map<string, number>> {
    const rows = (await this.dataSource.query(
      `SELECT template_id, count(*)::int AS n FROM chatbot_template_installs
        WHERE template_kind = 'code' GROUP BY template_id`,
    )) as { template_id: string; n: number }[];
    return new Map(rows.map((r) => [r.template_id, r.n]));
  }

  private notFound() {
    return new NotFoundException({
      errorCode: 'template_not_found',
      message: 'That template wasn’t found.',
    });
  }
}

export type { TemplateIssue };
