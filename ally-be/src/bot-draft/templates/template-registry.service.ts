import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { validateTemplate } from '../../chatbot/templates/template-validation';
import {
  TEMPLATES,
  type UseCaseTemplate,
} from '../../chatbot/templates/templates';
import { LoggerService } from '../../logger/logger.service';
import { AssistantTemplate } from '../entity/assistant-template.entity';

/** A template as the catalogue serves it, and where it came from. */
export interface EffectiveTemplate {
  template: UseCaseTemplate;
  /** `code`: the built-in. `managed`: a published version staff manage (version below). */
  source: 'code' | 'managed';
  /** Set for `managed`. */
  version: number | null;
  /** A managed template with the same key as a built-in, replacing it. */
  overrides: boolean;
}

/**
 * The built-in templates with staff's published versions laid over them: a published version
 * replaces the built-in of the same key in place, and a key that isn't built in is added after the
 * built-ins, oldest first. Pure; the registry service reads the rows and calls this.
 */
export function mergeTemplates(
  builtIn: readonly UseCaseTemplate[],
  published: readonly {
    manifest: UseCaseTemplate;
    version: number;
    publishedAt: Date | null;
  }[],
): EffectiveTemplate[] {
  const byKey = new Map(published.map((p) => [p.manifest.id, p]));
  const merged: EffectiveTemplate[] = builtIn.map((code) => {
    const managed = byKey.get(code.id);
    return managed
      ? {
          template: managed.manifest,
          source: 'managed',
          version: managed.version,
          overrides: true,
        }
      : { template: code, source: 'code', version: null, overrides: false };
  });
  const builtInIds = new Set(builtIn.map((t) => t.id));
  const added = published
    .filter((p) => !builtInIds.has(p.manifest.id))
    .sort(
      (a, b) =>
        (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0),
    )
    .map(
      (p): EffectiveTemplate => ({
        template: p.manifest,
        source: 'managed',
        version: p.version,
        overrides: false,
      }),
    );
  return [...merged, ...added];
}

const TTL_MS = 30_000;
const FAILURE_TTL_MS = 5_000;

/**
 * The templates the catalogue and the installs use: built-ins plus what staff have published.
 *
 * A published version that no longer passes `validateTemplate` is skipped (the built-in, if there
 * is one, serves instead) and logged: a bad row must never take the catalogue down. If the table
 * can't be read the built-ins serve, for a few seconds, then it tries again. The result is cached
 * for 30 seconds and dropped at once on a publish or retire on this instance; another instance
 * catches up within the cache time.
 */
@Injectable()
export class TemplateRegistryService {
  private readonly logger = LoggerService.getInstance(
    TemplateRegistryService.name,
  );
  private cache: { until: number; list: EffectiveTemplate[] } | null = null;

  constructor(
    @InjectRepository(AssistantTemplate)
    private readonly rows: Repository<AssistantTemplate>,
  ) {}

  async effective(): Promise<EffectiveTemplate[]> {
    const now = Date.now();
    if (this.cache && this.cache.until > now) return this.cache.list;
    try {
      const published = (
        await this.rows.find({ where: { status: 'published' } })
      ).filter((row) => {
        const bad = validateTemplate(row.manifest).filter(
          (i) => i.severity === 'error',
        );
        if (bad.length) {
          this.logger.warn(
            `Published template ${row.templateKey} v${row.version} skipped: ${bad[0].message}`,
          );
        }
        return !bad.length;
      });
      const list = mergeTemplates(
        TEMPLATES,
        published.map((r) => ({
          manifest: { ...r.manifest, id: r.templateKey },
          version: r.version,
          publishedAt: r.publishedAt ?? null,
        })),
      );
      this.cache = { until: now + TTL_MS, list };
      return list;
    } catch (e) {
      this.logger.error(
        `Template registry could not read published templates: ${(e as Error).message}`,
      );
      const list = mergeTemplates(TEMPLATES, []);
      this.cache = { until: now + FAILURE_TTL_MS, list };
      return list;
    }
  }

  async all(): Promise<UseCaseTemplate[]> {
    return (await this.effective()).map((e) => e.template);
  }

  async byId(id: string): Promise<EffectiveTemplate | undefined> {
    return (await this.effective()).find((e) => e.template.id === id);
  }

  invalidate(): void {
    this.cache = null;
  }
}
