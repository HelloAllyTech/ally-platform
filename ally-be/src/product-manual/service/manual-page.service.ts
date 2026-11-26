import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import {
  MANUAL_BODY_MAX,
  MANUAL_BREADCRUMB_DEPTH,
  MANUAL_PARENT_WALK_DEPTH,
  MANUAL_REASON_MAX,
  MANUAL_SUMMARY_MAX,
  MANUAL_TAG_LEN,
  MANUAL_TAG_MAX,
  MANUAL_TITLE_MAX,
} from '../constants/manual.constants';
import { ManualLink } from '../entity/manual-link.entity';
import { ManualPage } from '../entity/manual-page.entity';
import { ManualRevision } from '../entity/manual-revision.entity';
import {
  ManualAuthor,
  ManualWriteError,
  ManualWriteInput,
  ManualWriteResult,
  PageDetail,
  PageRow,
} from '../type/manual.types';
import { extractWikilinks, isValidSlug } from '../util/manual-slug.util';
import { ManualChangesService } from './manual-changes.service';
import { ManualScrubService } from './manual-scrub.service';

export function toPageRow(page: ManualPage): PageRow {
  return {
    slug: page.slug,
    title: page.title,
    summary: page.summary ?? '',
    parentSlug: page.parentSlug ?? null,
    position: page.position ?? 0,
    kind: page.kind,
    roles: page.roles ?? [],
    surfaces: page.surfaces ?? [],
    journeys: page.journeys ?? [],
    releaseState: page.releaseState,
    verifiedAt: page.verifiedAt
      ? new Date(page.verifiedAt).toISOString()
      : null,
    updatedAt: new Date(page.updatedAt).toISOString(),
  };
}

function cleanTags(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ManualWriteError(
      'invalid',
      `${field} must be a list of strings.`,
    );
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new ManualWriteError(
        'invalid',
        `${field} must be a list of strings.`,
      );
    }
    const tag = item.trim().slice(0, MANUAL_TAG_LEN);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, MANUAL_TAG_MAX);
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * THE single writer of the Product Manual (safety rule 4): the import, a revert, the chat agent and
 * the weekly agent all change a page through `write()`, and nothing else touches title, summary or
 * body. One transaction validates, scrubs, writes the page, appends a revision (a full copy), rebuilds
 * the page's `[[links]]` and, for any author but `seed`, marks the page "ships in next release".
 */
@Injectable()
export class ManualPageService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ManualPage)
    private readonly pages: Repository<ManualPage>,
    private readonly scrub: ManualScrubService,
    private readonly changes: ManualChangesService,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────────────

  getBySlug(slug: string): Promise<ManualPage | null> {
    if (!isValidSlug(slug)) return Promise.resolve(null);
    return this.pages.findOne({ where: { slug, deletedAt: IsNull() } });
  }

  async list(): Promise<ManualPage[]> {
    const rows = await this.pages.find({ where: { deletedAt: IsNull() } });
    return rows.sort(
      (a, b) =>
        (a.parentSlug ?? '').localeCompare(b.parentSlug ?? '') ||
        (a.position ?? 0) - (b.position ?? 0) ||
        a.title.localeCompare(b.title),
    );
  }

  async detail(slug: string): Promise<PageDetail | null> {
    const page = await this.getBySlug(slug);
    if (!page) return null;
    const [outlinks, backlinks, children, lastChange, breadcrumb] =
      await Promise.all([
        this.dataSource.query(
          `SELECT p.slug, p.title
             FROM manual_links l
             JOIN manual_pages p ON p.slug = l.to_slug AND p.deleted_at IS NULL
            WHERE l.from_slug = $1::varchar AND l.to_slug <> $1::varchar
            ORDER BY p.title`,
          [page.slug],
        ) as Promise<{ slug: string; title: string }[]>,
        this.dataSource.query(
          `SELECT p.slug, p.title
             FROM manual_links l
             JOIN manual_pages p ON p.slug = l.from_slug AND p.deleted_at IS NULL
            WHERE l.to_slug = $1::varchar AND l.from_slug <> $1::varchar
            ORDER BY p.title`,
          [page.slug],
        ) as Promise<{ slug: string; title: string }[]>,
        this.dataSource.query(
          `SELECT slug, title, summary
             FROM manual_pages
            WHERE parent_slug = $1::varchar AND deleted_at IS NULL
            ORDER BY position, title`,
          [page.slug],
        ) as Promise<{ slug: string; title: string; summary: string }[]>,
        this.changes.list({ slug: page.slug, limit: 1 }),
        this.breadcrumb(page),
      ]);
    return {
      ...toPageRow(page),
      body: page.body ?? '',
      verifiedRef: page.verifiedRef ?? null,
      backlinks: backlinks.map(({ slug: s, title }) => ({ slug: s, title })),
      outlinks: outlinks.map(({ slug: s, title }) => ({ slug: s, title })),
      breadcrumb,
      children: children.map(({ slug: s, title, summary }) => ({
        slug: s,
        title,
        summary: summary ?? '',
      })),
      lastChange: lastChange[0] ?? null,
    };
  }

  /** Ancestors, top-level first. Stops at a missing parent, a cycle or the depth guard. */
  private async breadcrumb(
    page: ManualPage,
  ): Promise<{ slug: string; title: string }[]> {
    const trail: { slug: string; title: string }[] = [];
    const seen = new Set<string>([page.slug]);
    let next = page.parentSlug ?? null;
    while (next && trail.length < MANUAL_BREADCRUMB_DEPTH && !seen.has(next)) {
      seen.add(next);
      const parent = await this.pages.findOne({
        where: { slug: next, deletedAt: IsNull() },
      });
      if (!parent) break;
      trail.unshift({ slug: parent.slug, title: parent.title });
      next = parent.parentSlug ?? null;
    }
    return trail;
  }

  // ── The single writer ──────────────────────────────────────────────────────

  async write(
    input: ManualWriteInput,
    author: ManualAuthor,
    userId?: number | null,
  ): Promise<ManualWriteResult> {
    if (!input || !isValidSlug(input.slug)) {
      throw new ManualWriteError(
        'invalid_slug',
        'A slug is lowercase letters and digits joined by single hyphens (at most 120 characters), e.g. "running-a-roleplay".',
      );
    }
    this.validateInput(input, author);

    try {
      return await this.dataSource.transaction((em) =>
        this.writeIn(em, input, author, userId ?? null),
      );
    } catch (error) {
      // Two writers creating the same new slug at once: the unique index refuses the second.
      if ((error as { code?: string })?.code === '23505') {
        throw new ManualWriteError(
          'invalid',
          `A page "${input.slug}" was created at the same moment. Read it and write again.`,
        );
      }
      throw error;
    }
  }

  private validateInput(input: ManualWriteInput, author: ManualAuthor): void {
    const { slug } = input;
    if (input.title !== undefined) {
      if (typeof input.title !== 'string' || !input.title.trim()) {
        throw new ManualWriteError('invalid', 'The title cannot be empty.');
      }
      if (input.title.length > MANUAL_TITLE_MAX) {
        throw new ManualWriteError(
          'too_large',
          `The title is over ${MANUAL_TITLE_MAX} characters.`,
        );
      }
    }
    if (input.summary !== undefined) {
      if (typeof input.summary !== 'string') {
        throw new ManualWriteError('invalid', 'The summary must be text.');
      }
      if (input.summary.length > MANUAL_SUMMARY_MAX) {
        throw new ManualWriteError(
          'too_large',
          `The summary is over ${MANUAL_SUMMARY_MAX} characters; keep it to a sentence or two.`,
        );
      }
    }
    if (input.body !== undefined) {
      if (typeof input.body !== 'string') {
        throw new ManualWriteError('invalid', 'The body must be text.');
      }
      if (input.body.length > MANUAL_BODY_MAX) {
        throw new ManualWriteError(
          'too_large',
          `The body is over ${MANUAL_BODY_MAX} characters. Split it into child pages.`,
        );
      }
    }
    if (input.parentSlug !== undefined && input.parentSlug !== null) {
      if (!isValidSlug(input.parentSlug)) {
        throw new ManualWriteError(
          'invalid_slug',
          'The parent slug is not a valid slug.',
        );
      }
      if (input.parentSlug === slug) {
        throw new ManualWriteError(
          'invalid',
          'A page cannot be its own parent.',
        );
      }
    }
    if (
      input.kind !== undefined &&
      input.kind !== 'section' &&
      input.kind !== 'page'
    ) {
      throw new ManualWriteError(
        'invalid',
        'kind must be "section" or "page".',
      );
    }
    if (
      input.position !== undefined &&
      (!Number.isInteger(input.position) || Math.abs(input.position) > 100_000)
    ) {
      throw new ManualWriteError('invalid', 'position must be a whole number.');
    }
    if (
      typeof author?.reason !== 'string' ||
      author.reason.length > MANUAL_REASON_MAX
    ) {
      throw new ManualWriteError(
        'invalid',
        `A reason (at most ${MANUAL_REASON_MAX} characters) is required.`,
      );
    }
    for (const [field, text] of [
      ['title', input.title],
      ['summary', input.summary],
      ['body', input.body],
      ['reason', author.reason],
    ] as const) {
      if (!text) continue;
      const verdict = this.scrub.check(text);
      if (!verdict.ok) {
        throw new ManualWriteError(
          'scrubbed',
          `The ${field}: ${verdict.reason}`,
        );
      }
    }
  }

  private async writeIn(
    em: EntityManager,
    input: ManualWriteInput,
    author: ManualAuthor,
    userId: number | null,
  ): Promise<ManualWriteResult> {
    const existing = await em.findOne(ManualPage, {
      where: { slug: input.slug, deletedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });

    if (!existing && !input.title?.trim()) {
      throw new ManualWriteError('invalid', 'A new page needs a title.');
    }

    // The parent chain must not loop back to this page.
    if (input.parentSlug) {
      let cursor: string | null = input.parentSlug;
      for (let i = 0; cursor && i < MANUAL_PARENT_WALK_DEPTH; i++) {
        if (cursor === input.slug) {
          throw new ManualWriteError(
            'invalid',
            `"${input.parentSlug}" is already below "${input.slug}", so it cannot be its parent.`,
          );
        }
        const up: ManualPage | null = await em.findOne(ManualPage, {
          where: { slug: cursor, deletedAt: IsNull() },
        });
        cursor = up?.parentSlug ?? null;
      }
    }

    const next = {
      title: input.title?.trim() ?? existing?.title ?? '',
      summary: input.summary ?? existing?.summary ?? '',
      body: input.body ?? existing?.body ?? '',
      parentSlug:
        input.parentSlug !== undefined
          ? input.parentSlug
          : (existing?.parentSlug ?? null),
      position: input.position ?? existing?.position ?? 0,
      kind: input.kind ?? existing?.kind ?? 'page',
      roles:
        input.roles !== undefined
          ? cleanTags(input.roles, 'roles')
          : (existing?.roles ?? []),
      surfaces:
        input.surfaces !== undefined
          ? cleanTags(input.surfaces, 'surfaces')
          : (existing?.surfaces ?? []),
      journeys:
        input.journeys !== undefined
          ? cleanTags(input.journeys, 'journeys')
          : (existing?.journeys ?? []),
    };

    const now = new Date();
    let page: ManualPage;
    let created = false;
    let textChanged: boolean;

    if (!existing) {
      created = true;
      textChanged = true;
      page = em.create(ManualPage, {
        slug: input.slug,
        ...next,
        releaseState: 'live',
        nextSince: null,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      textChanged =
        existing.title !== next.title ||
        (existing.summary ?? '') !== next.summary ||
        (existing.body ?? '') !== next.body;
      const metaChanged =
        (existing.parentSlug ?? null) !== next.parentSlug ||
        existing.position !== next.position ||
        existing.kind !== next.kind ||
        !sameList(existing.roles ?? [], next.roles) ||
        !sameList(existing.surfaces ?? [], next.surfaces) ||
        !sameList(existing.journeys ?? [], next.journeys);
      if (!textChanged && !metaChanged) {
        return {
          page: existing,
          revision: null,
          changed: false,
          created: false,
        };
      }
      page = existing;
      Object.assign(page, next, { updatedAt: now });
    }

    // "Ships in next release" follows a text change by anyone but the importer.
    if (textChanged && author.kind !== 'seed' && page.releaseState !== 'next') {
      page.releaseState = 'next';
      page.nextSince = now;
    }

    page = await em.save(ManualPage, page);

    let revision: ManualRevision | null = null;
    if (textChanged) {
      revision = await em.save(
        ManualRevision,
        em.create(ManualRevision, {
          pageId: page.id,
          title: page.title,
          summary: page.summary,
          body: page.body,
          authorKind: author.kind,
          authorRef: author.ref ?? (userId != null ? String(userId) : null),
          reason: author.reason,
          sourceRefs: author.sourceRefs ?? [],
          revertOf: author.revertOf ?? null,
          createdAt: now,
        }),
      );
      await this.rebuildLinks(em, page.slug, page.body, now);
    }

    return { page, revision, changed: true, created };
  }

  private async rebuildLinks(
    em: EntityManager,
    slug: string,
    body: string,
    now: Date,
  ): Promise<void> {
    await em.delete(ManualLink, { fromSlug: slug });
    const targets = extractWikilinks(body).filter((to) => to !== slug);
    if (targets.length) {
      await em.insert(
        ManualLink,
        targets.map((toSlug) => ({ fromSlug: slug, toSlug, createdAt: now })),
      );
    }
  }

  // ── Other mutations that are not text ──────────────────────────────────────

  /** Record that an agent checked this page against master at `ref`. */
  async markVerified(slug: string, ref?: string | null): Promise<void> {
    const result = await this.pages.update(
      { slug, deletedAt: IsNull() },
      { verifiedAt: new Date(), verifiedRef: ref ? ref.slice(0, 80) : null },
    );
    if (!result.affected) {
      throw new ManualWriteError('not_found', `No page "${slug}".`);
    }
  }

  /** A tagged release went out: every "ships in next release" page is live now. */
  async markAllReleased(): Promise<number> {
    const result = await this.pages.update(
      { releaseState: 'next', deletedAt: IsNull() },
      { releaseState: 'live', nextSince: null },
    );
    return result.affected ?? 0;
  }

  /** Restore an older revision as a new one (history is never rewritten). */
  async revert(
    slug: string,
    revisionId: string,
    userId: number,
  ): Promise<{ page: ManualPage; revision: ManualRevision }> {
    const page = await this.getBySlug(slug);
    if (!page) throw new ManualWriteError('not_found', `No page "${slug}".`);
    const target = /^[0-9a-f-]{36}$/i.test(revisionId ?? '')
      ? await this.dataSource.getRepository(ManualRevision).findOne({
          where: { id: revisionId, pageId: page.id },
        })
      : null;
    if (!target) {
      throw new ManualWriteError(
        'not_found',
        'That version of this page does not exist.',
      );
    }
    const result = await this.write(
      {
        slug,
        title: target.title,
        summary: target.summary,
        body: target.body,
      },
      {
        kind: 'revert',
        ref: String(userId),
        reason: `Reverted to the version of ${new Date(target.createdAt).toISOString().slice(0, 10)}`,
        revertOf: target.id,
      },
      userId,
    );
    if (!result.revision) {
      throw new ManualWriteError(
        'invalid',
        'The page already reads exactly like that version.',
      );
    }
    return { page: result.page, revision: result.revision };
  }
}
