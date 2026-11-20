import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ExecutionManager } from 'src/common/execution/execution-manager';
import { BLOG_AUTHORING_SKILL } from 'src/prompt/contracts';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';

import { BLOG_COVER_COLOR_PATTERN } from '../constants/blog.constants';
import { BlogResponseDto } from '../dto/blog-response.dto';
import { CreateBlogDto } from '../dto/create-blog.dto';
import { GetBlogsQueryDto } from '../dto/get-blogs.dto';
import { UpdateBlogDto } from '../dto/update-blog.dto';
import { BlogImageUploadContentType } from '../enum/blog-image-upload-content-type.enum';
import { BlogStatus } from '../enum/blog-status.enum';
import {
  blogAuthoringGuide,
  findBodyIssues,
} from '../util/blog-authoring-guide.util';
import { BlogReviewService } from './blog-review.service';
import { BlogService } from './blog.service';

export interface BlogToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TITLE_MAX = 255;
const SLUG_MAX = 280;
const AUTHOR_MAX = 120;
const LIST_LIMIT_MAX = 50;

const postFields = {
  title: { type: 'string', description: 'Post title, up to 255 characters.' },
  slug: {
    type: 'string',
    description: 'Optional URL slug; made from the title when left out.',
  },
  tldr: {
    type: 'string',
    description: 'The answer in one or two sentences (about 280 characters).',
  },
  body: {
    type: 'string',
    description:
      'Rich-text HTML in the allowed tags only. Call blog_guide for the rules.',
  },
  tags: {
    type: 'array',
    items: { type: 'string' },
    description: 'Short lowercase tags; reuse existing ones.',
  },
  coverColor: {
    type: 'string',
    description: 'A #RRGGBB fill shown when there is no header image.',
  },
  authorName: { type: 'string', description: 'The byline.' },
  authorEmail: {
    type: 'string',
    description:
      "The author's email, shown with the byline. Defaults to the email of the person whose key you use.",
  },
  headerImageUrl: {
    type: 'string',
    description: 'An https image URL from request_image_upload.',
  },
};

/**
 * The tools Claude Code gets for writing blog posts. Everything an agent writes is a DRAFT: there
 * is no tool that publishes, unpublishes or deletes, and a post that is already published is
 * read-only here. Drafts are written as the key's owner.
 */
@Injectable()
export class BlogAuthoringToolsService {
  constructor(
    private readonly blogs: BlogService,
    private readonly prompts: PromptSharedService,
    private readonly review: BlogReviewService,
    private readonly dataSource: DataSource,
  ) {}

  definitions(): BlogToolDefinition[] {
    return [
      {
        name: 'blog_guide',
        description:
          'Read this first. The Ally blog authoring skill (what a post must contain, how to illustrate it, the voice, what never goes in a public post) plus what the blog supports (fields, the HTML the body may use, image rules, tags and cover colours already in use).',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list_posts',
        description:
          'List blog posts (drafts and published) so you do not repeat a topic, or to find a draft to continue.',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['DRAFT', 'PUBLISHED'] },
            search: { type: 'string' },
            limit: { type: 'number', description: 'Up to 50; default 20.' },
          },
        },
      },
      {
        name: 'get_post',
        description: 'Read one post (any status) by id, with its body.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      {
        name: 'list_suggestions',
        description:
          'Read the suggestions reviewers sent on a draft through its review link (open ones first). A person shares the draft and marks suggestions done; you read them and change the draft with update_draft.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
      {
        name: 'request_image_upload',
        description:
          'Get a one-time upload URL for an image. Upload the file with curl -X PUT -H "Content-Type: <contentType>" --data-binary @<file> "<presignedUrl>", then use imageUrl in the body or as headerImageUrl. Never send image bytes through a tool.',
        inputSchema: {
          type: 'object',
          properties: {
            fileName: { type: 'string', description: 'For example flow.svg' },
            contentType: {
              type: 'string',
              enum: Object.values(BlogImageUploadContentType),
            },
            fileSize: { type: 'number', description: 'Size in bytes.' },
          },
          required: ['fileName', 'contentType', 'fileSize'],
        },
      },
      {
        name: 'create_draft',
        description:
          'Create a blog post as a DRAFT. A person reviews and publishes it in Ally admin. Returns the draft and any problems found in the body (tags or attributes the blog removes, images without alt text) for you to fix with update_draft.',
        inputSchema: {
          type: 'object',
          properties: postFields,
          required: ['title'],
        },
      },
      {
        name: 'update_draft',
        description:
          'Change a DRAFT post. Send only the fields to change. A published post cannot be edited here.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string' }, ...postFields },
          required: ['id'],
        },
      },
    ];
  }

  /** Run one tool as the key's owner. Returns a JSON-able result. */
  async call(
    name: string,
    args: Record<string, any>,
    ownerId: number,
  ): Promise<unknown> {
    return ExecutionManager.runWithContext(async () => {
      ExecutionManager.setAuthContext(String(ownerId), '');
      switch (name) {
        case 'blog_guide':
          return this.guide();
        case 'list_posts':
          return this.list(args);
        case 'get_post':
          return this.blogs.getById(this.id(args));
        case 'list_suggestions':
          return this.review.listSuggestions(this.id(args));
        case 'request_image_upload':
          return this.requestUpload(args);
        case 'create_draft':
          return this.create(args, ownerId);
        case 'update_draft':
          return this.update(args);
        default:
          throw new BadRequestException(`Unknown tool: ${name}`);
      }
    });
  }

  private id(args: Record<string, any>): string {
    const id = String(args?.id ?? '').trim();
    if (!id) throw new BadRequestException('id is required');
    return id;
  }

  private async guide() {
    const { tags } = await this.blogs.getPublishedTags();
    // The editorial skill is a Skills Store prompt, so people change how posts are written without a deploy.
    const skill = await this.prompts
      .getPromptByCode(BLOG_AUTHORING_SKILL.code)
      .catch(() => null);
    return blogAuthoringGuide(
      tags.map((t) => t.tag),
      skill,
    );
  }

  private async list(args: Record<string, any>) {
    const query = new GetBlogsQueryDto();
    if (args?.status) {
      const status = String(args.status).toUpperCase();
      if (!Object.values(BlogStatus).includes(status as BlogStatus))
        throw new BadRequestException('status must be DRAFT or PUBLISHED');
      query.status = status as BlogStatus;
    }
    if (args?.search) query.search = String(args.search);
    query.limit = Math.min(
      Math.max(Number(args?.limit) || 20, 1),
      LIST_LIMIT_MAX,
    );
    const { blogs, count } = await this.blogs.getBlogs(query);
    return {
      count,
      posts: blogs.map((b) => ({
        id: b.id,
        title: b.title,
        slug: b.slug,
        status: b.status,
        tags: b.tags,
        updatedAt: b.updatedAt,
      })),
    };
  }

  private async requestUpload(args: Record<string, any>) {
    const contentType = String(args?.contentType ?? '');
    if (
      !Object.values(BlogImageUploadContentType).includes(
        contentType as BlogImageUploadContentType,
      )
    ) {
      throw new BadRequestException(
        `contentType must be one of ${Object.values(BlogImageUploadContentType).join(', ')}`,
      );
    }
    const fileName = String(args?.fileName ?? '').trim();
    if (!fileName) throw new BadRequestException('fileName is required');
    const fileSize = Number(args?.fileSize);
    if (!Number.isFinite(fileSize) || fileSize < 1)
      throw new BadRequestException('fileSize (bytes) is required');
    const { presignedUrl, imageUrl } = await this.blogs.createImageUploadUrl({
      fileName,
      fileSize,
      contentType: contentType as BlogImageUploadContentType,
    });
    return {
      presignedUrl,
      imageUrl,
      next: `curl -X PUT -H "Content-Type: ${contentType}" --data-binary @<file> "<presignedUrl>", then use imageUrl.`,
    };
  }

  private fields(args: Record<string, any>): Partial<CreateBlogDto> {
    const out: Partial<CreateBlogDto> = {};
    if (args.title !== undefined) {
      const title = String(args.title).trim();
      if (!title || title.length > TITLE_MAX)
        throw new BadRequestException(
          `title is required, up to ${TITLE_MAX} characters`,
        );
      out.title = title;
    }
    if (args.slug !== undefined) {
      const slug = String(args.slug).trim();
      if (slug.length > SLUG_MAX)
        throw new BadRequestException(`slug is up to ${SLUG_MAX} characters`);
      out.slug = slug || undefined;
    }
    if (args.tldr !== undefined) out.tldr = String(args.tldr);
    if (args.body !== undefined) out.body = String(args.body);
    if (args.tags !== undefined) {
      if (
        !Array.isArray(args.tags) ||
        args.tags.some((t: unknown) => typeof t !== 'string')
      )
        throw new BadRequestException('tags must be a list of strings');
      // Keep the casing the agent gave (existing tags are mixed case); only drop duplicates.
      const seen = new Set<string>();
      out.tags = (args.tags as string[])
        .map((t) => t.trim())
        .filter(
          (t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()),
        );
    }
    if (args.coverColor !== undefined) {
      if (!BLOG_COVER_COLOR_PATTERN.test(String(args.coverColor)))
        throw new BadRequestException('coverColor must be a #RRGGBB colour');
      out.coverColor = String(args.coverColor);
    }
    if (args.authorName !== undefined) {
      const authorName = String(args.authorName).trim();
      if (authorName.length > AUTHOR_MAX)
        throw new BadRequestException(
          `authorName is up to ${AUTHOR_MAX} characters`,
        );
      out.authorName = authorName;
    }
    if (args.authorEmail !== undefined) {
      const email = String(args.authorEmail).trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new BadRequestException(
          'authorEmail does not look like an email',
        );
      out.authorEmail = email;
    }
    if (args.headerImageUrl !== undefined) {
      const url = String(args.headerImageUrl).trim();
      if (url && !/^https:\/\//i.test(url))
        throw new BadRequestException('headerImageUrl must be an https URL');
      out.headerImageUrl = url;
    }
    return out;
  }

  /** A tag already in use keeps its exact spelling and capitalisation ("AI", not "ai"). */
  private async canonicalTags(tags: string[]): Promise<string[]> {
    const known = new Map(
      (await this.blogs.getPublishedTags()).tags.map((t) => [
        t.tag.toLowerCase(),
        t.tag,
      ]),
    );
    return tags.map((t) => known.get(t.toLowerCase()) ?? t);
  }

  /** The email of the person whose key this is: the default byline email. */
  private async ownerEmail(ownerId: number): Promise<string | undefined> {
    const rows: Array<{ email?: string }> = await this.dataSource
      .query('SELECT email FROM users WHERE id = $1', [ownerId])
      .catch(() => []);
    return rows[0]?.email || undefined;
  }

  private async create(args: Record<string, any>, ownerId: number) {
    const fields = this.fields(args);
    if (!fields.title) throw new BadRequestException('title is required');
    if (fields.tags) fields.tags = await this.canonicalTags(fields.tags);
    if (fields.authorEmail === undefined) {
      fields.authorEmail = await this.ownerEmail(ownerId);
    }
    // Always a draft, whatever the caller sent.
    const created = await this.blogs.create({
      ...(fields as CreateBlogDto),
      status: BlogStatus.DRAFT,
    });
    return this.summary(created, findBodyIssues(fields.body));
  }

  private async update(args: Record<string, any>) {
    const id = this.id(args);
    const existing = await this.blogs.getById(id);
    if (existing.status !== BlogStatus.DRAFT) {
      throw new BadRequestException(
        'This post is published. Ask a person to unpublish it in Ally admin before an agent edits it.',
      );
    }
    const fields = this.fields(args) as UpdateBlogDto;
    if (fields.tags) fields.tags = await this.canonicalTags(fields.tags);
    // Never change the status from here.
    delete (fields as { status?: BlogStatus }).status;
    const updated = await this.blogs.update(id, fields);
    return this.summary(updated, findBodyIssues(fields.body));
  }

  private summary(
    post: BlogResponseDto,
    issues: ReturnType<typeof findBodyIssues>,
  ) {
    const body = post.body ?? '';
    return {
      id: post.id,
      slug: post.slug,
      status: post.status,
      title: post.title,
      tldr: post.tldr,
      tags: post.tags,
      coverColor: post.coverColor,
      authorName: post.authorName,
      headerImageUrl: post.headerImageUrl,
      bodyCharacters: body.length,
      images: (body.match(/<img\b/gi) ?? []).length,
      issues,
      next: issues.length
        ? 'Fix the issues with update_draft, then ask a person to review and publish in Ally admin → Blog.'
        : 'Draft saved. Ask a person to review and publish it in Ally admin → Blog.',
    };
  }
}
