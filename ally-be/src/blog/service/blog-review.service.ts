import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';

import { RedisService } from 'src/redis/service/redis.service';

import {
  BlogReviewLink,
  BlogReviewSuggestion,
  BlogSuggestionStatus,
} from '../entity/blog-review.entity';
import { BlogStatus } from '../enum/blog-status.enum';
import { BlogService } from './blog.service';

const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;
/** One reviewer (one IP) can send this many suggestions per hour on one link. */
const SUGGESTIONS_PER_HOUR = 10;
/** A link stops taking suggestions after this many in total. */
const SUGGESTIONS_PER_LINK = 200;
export const SUGGESTION_LIMITS = {
  name: 80,
  email: 255,
  comment: 2000,
  quote: 500,
};

export interface ReviewLinkView {
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface SuggestionView {
  id: string;
  name: string;
  email: string | null;
  comment: string;
  quote: string | null;
  status: BlogSuggestionStatus;
  createdAt: Date;
}

const toLink = (l: BlogReviewLink): ReviewLinkView => ({
  token: l.token,
  expiresAt: l.expiresAt,
  createdAt: l.createdAt,
});

const toSuggestion = (s: BlogReviewSuggestion): SuggestionView => ({
  id: s.id,
  name: s.name,
  email: s.email ?? null,
  comment: s.comment,
  quote: s.quote ?? null,
  status: s.status,
  createdAt: s.createdAt,
});

/** Strip control characters and trim; plain text only (the pages render it as text). */
const clean = (value: unknown, max: number, keepNewlines = false): string => {
  const text = String(value ?? '')
    .replace(
      keepNewlines
        ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
        : /[\u0000-\u001F\u007F]/g,
      ' ',
    )
    .trim();
  return text.slice(0, max);
};

/**
 * Sharing a DRAFT post for review. A link is a long random token: anyone who has it can read the
 * draft and send suggestions, no sign-in. It expires, can be switched off, and stops showing the
 * draft once the post is published (the page then sends the reader to the public post).
 */
@Injectable()
export class BlogReviewService {
  constructor(
    @InjectRepository(BlogReviewLink)
    private readonly links: Repository<BlogReviewLink>,
    @InjectRepository(BlogReviewSuggestion)
    private readonly suggestions: Repository<BlogReviewSuggestion>,
    private readonly blogs: BlogService,
    private readonly redis: RedisService,
  ) {}

  // ── Admin ────────────────────────────────────────────────────────────────

  private activeLink(blogId: string) {
    return this.links.findOne({
      where: {
        blogId,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async getForPost(blogId: string) {
    await this.blogs.getById(blogId);
    const link = await this.activeLink(blogId);
    const rows = await this.suggestions.find({
      where: { blogId },
      order: { createdAt: 'DESC' },
    });
    return {
      link: link ? toLink(link) : null,
      suggestions: rows.map(toSuggestion),
    };
  }

  async createLink(
    blogId: string,
    days: number | undefined,
    userId: number,
  ): Promise<ReviewLinkView> {
    const post = await this.blogs.getById(blogId);
    if (post.status !== BlogStatus.DRAFT) {
      throw new BadRequestException(
        'This post is published and public. Share its public link instead.',
      );
    }
    const existing = await this.activeLink(blogId);
    if (existing) return toLink(existing);
    const span = Math.min(
      Math.max(Math.floor(Number(days) || DEFAULT_DAYS), 1),
      MAX_DAYS,
    );
    const link = await this.links.save(
      this.links.create({
        blogId,
        token: randomBytes(24).toString('base64url'),
        expiresAt: new Date(Date.now() + span * 86_400_000),
        createdBy: userId,
      }),
    );
    return toLink(link);
  }

  async revokeLink(blogId: string): Promise<{ success: boolean }> {
    await this.blogs.getById(blogId);
    await this.links.update(
      { blogId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return { success: true };
  }

  async setSuggestionStatus(
    blogId: string,
    suggestionId: string,
    status: BlogSuggestionStatus,
  ): Promise<SuggestionView> {
    const row = await this.suggestions.findOne({
      where: { id: suggestionId, blogId },
    });
    if (!row) throw new NotFoundException('Suggestion not found');
    row.status = status;
    return toSuggestion(await this.suggestions.save(row));
  }

  /** For the authoring tools: the suggestions on a post, open ones first. */
  async listSuggestions(blogId: string): Promise<SuggestionView[]> {
    await this.blogs.getById(blogId);
    const rows = await this.suggestions.find({
      where: { blogId },
      order: { createdAt: 'DESC' },
    });
    return rows
      .sort(
        (a, b) =>
          Number(a.status === BlogSuggestionStatus.RESOLVED) -
          Number(b.status === BlogSuggestionStatus.RESOLVED),
      )
      .map(toSuggestion);
  }

  // ── Public (by link) ─────────────────────────────────────────────────────

  private async linkByToken(token: string): Promise<BlogReviewLink> {
    const clean = String(token ?? '').slice(0, 64);
    const link = clean
      ? await this.links.findOne({
          where: { token: clean, revokedAt: IsNull() },
        })
      : null;
    if (!link || link.expiresAt.getTime() <= Date.now()) {
      throw new NotFoundException('This review link is not valid any more.');
    }
    return link;
  }

  async viewByToken(token: string) {
    const link = await this.linkByToken(token);
    const post = await this.blogs.getById(link.blogId);
    return {
      status: post.status,
      slug: post.slug,
      expiresAt: link.expiresAt,
      post,
    };
  }

  async addSuggestion(
    token: string,
    body: {
      name?: unknown;
      email?: unknown;
      comment?: unknown;
      quote?: unknown;
    },
    ip: string | undefined,
  ): Promise<{ success: boolean }> {
    const link = await this.linkByToken(token);
    const post = await this.blogs.getById(link.blogId);
    if (post.status !== BlogStatus.DRAFT) {
      throw new BadRequestException('This post is published.');
    }

    const name = clean(body.name, SUGGESTION_LIMITS.name);
    const comment = clean(body.comment, SUGGESTION_LIMITS.comment, true);
    const email = clean(body.email, SUGGESTION_LIMITS.email);
    const quote = clean(body.quote, SUGGESTION_LIMITS.quote, true);
    if (!name) throw new BadRequestException('Your name is required.');
    if (!comment) throw new BadRequestException('A comment is required.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('That email address does not look right.');
    }

    const total = await this.suggestions.count({
      where: { linkId: link.id },
    });
    if (total >= SUGGESTIONS_PER_LINK) {
      throw new HttpException(
        'This review has reached its limit of suggestions.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const bucket = `blog:review:rate:${link.id}:${ip ?? 'unknown'}:${Math.floor(Date.now() / 3_600_000)}`;
    const count =
      Number((await this.redis.get(bucket).catch(() => null)) ?? 0) + 1;
    await this.redis.set(bucket, String(count), 3700).catch(() => undefined);
    if (count > SUGGESTIONS_PER_HOUR) {
      throw new HttpException(
        'You are sending suggestions too quickly. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.suggestions.save(
      this.suggestions.create({
        blogId: link.blogId,
        linkId: link.id,
        name,
        email: email || null,
        comment,
        quote: quote || null,
      }),
    );
    return { success: true };
  }
}
