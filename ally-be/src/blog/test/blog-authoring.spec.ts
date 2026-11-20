import { UnauthorizedException } from '@nestjs/common';

import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

import { BlogAuthoringController } from '../controller/blog-authoring.controller';
import { BlogStatus } from '../enum/blog-status.enum';
import {
  BLOG_AUTHOR_KEY_PREFIX,
  BlogAuthorKeyService,
  hashBlogAuthorKey,
} from '../service/blog-author-key.service';
import { BlogAuthoringToolsService } from '../service/blog-authoring-tools.service';
import {
  blogAuthoringGuide,
  findBodyIssues,
} from '../util/blog-authoring-guide.util';

const post = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  title: 'T',
  slug: 't',
  tldr: null,
  body: '<p>x</p>',
  tags: [],
  coverColor: '#8B9A6D',
  authorName: null,
  headerImageUrl: null,
  status: BlogStatus.DRAFT,
  publishedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

describe('blog body issues', () => {
  it('is clean for allowed markup with alt text', () => {
    expect(
      findBodyIssues(
        '<h2>A</h2><p>b <a href="https://x.y">c</a></p><img src="https://x.y/a.png" alt="A chart"><p><em>Caption</em></p>',
      ),
    ).toEqual([]);
  });

  it('names what the blog would strip, so the agent can fix it', () => {
    const problems = findBodyIssues(
      '<div class="x" style="color:red"><span>a</span></div><img src="data:image/png;base64,AAA"><h1>T</h1>',
    ).map((i) => i.problem);
    expect(problems.join(' | ')).toMatch(/<div>, <span>/);
    expect(problems.join(' | ')).toMatch(/data: URL/);
    expect(problems.join(' | ')).toMatch(/style, class/);
    expect(problems.join(' | ')).toMatch(/alt text/);
    expect(problems.join(' | ')).toMatch(/<h1>/);
  });

  it('lists existing tags in the guide', () => {
    const guide = blogAuthoringGuide(['release', 'product']);
    expect(guide.fields.tags).toContain('release, product');
    expect(guide.what).toMatch(/cannot publish/);
  });
});

describe('BlogAuthoringToolsService', () => {
  const make = (existing = post()) => {
    const prompts = { getPromptByCode: jest.fn(async () => '# Skill text') };
    const blogs = {
      create: jest.fn(async (dto: any) => post({ ...dto, status: dto.status })),
      update: jest.fn(async (_id: string, dto: any) => post({ ...dto })),
      getById: jest.fn(async () => existing),
      getBlogs: jest.fn(async () => ({ blogs: [post()], count: 1 })),
      getPublishedTags: jest.fn(async () => ({
        tags: [{ tag: 'release', count: 2 }],
      })),
      createImageUploadUrl: jest.fn(async () => ({
        presignedUrl: 'https://s3/put',
        imageUrl: 'https://cdn/blog/a.png',
      })),
    };
    return {
      blogs,
      prompts,
      svc: new BlogAuthoringToolsService(blogs as any, prompts as any),
    };
  };

  it('always creates a draft, even when asked to publish', async () => {
    const { blogs, svc } = make();
    await svc.call(
      'create_draft',
      { title: 'Hello', status: 'PUBLISHED', tags: ['Release', ' release '] },
      7,
    );
    expect(blogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Hello',
        status: BlogStatus.DRAFT,
        tags: ['release'],
      }),
    );
  });

  it('returns issues with the draft so they can be fixed', async () => {
    const { svc } = make();
    const result: any = await svc.call(
      'create_draft',
      { title: 'Hello', body: '<div>x</div>' },
      7,
    );
    expect(result.issues).toHaveLength(1);
    expect(result.next).toMatch(/Fix the issues/);
  });

  it('refuses to edit a published post', async () => {
    const { blogs, svc } = make(post({ status: BlogStatus.PUBLISHED }));
    await expect(
      svc.call('update_draft', { id: 'p1', title: 'New' }, 7),
    ).rejects.toThrow(/published/);
    expect(blogs.update).not.toHaveBeenCalled();
  });

  it('never changes the status when updating a draft', async () => {
    const { blogs, svc } = make();
    await svc.call(
      'update_draft',
      { id: 'p1', title: 'New', status: 'PUBLISHED' },
      7,
    );
    const dto = blogs.update.mock.calls[0][1];
    expect(dto.title).toBe('New');
    expect('status' in dto).toBe(false);
  });

  it('serves the live skill from the Skills Store with the guide', async () => {
    const { svc, prompts } = make();
    const guide: any = await svc.call('blog_guide', {}, 7);
    expect(prompts.getPromptByCode).toHaveBeenCalledWith(
      'blog_authoring_skill',
    );
    expect(guide.skill).toBe('# Skill text');
    expect(guide.body.allowedTags).toContain('img');
  });

  it('says so when the skill cannot be loaded', async () => {
    const { svc, prompts } = make();
    prompts.getPromptByCode.mockResolvedValueOnce(null as any);
    const guide: any = await svc.call('blog_guide', {}, 7);
    expect(guide.skill).toMatch(/could not be loaded/);
  });

  it('has no tool that publishes or deletes', () => {
    const names = make()
      .svc.definitions()
      .map((d) => d.name);
    expect(names).toEqual([
      'blog_guide',
      'list_posts',
      'get_post',
      'request_image_upload',
      'create_draft',
      'update_draft',
    ]);
    expect(names.join(' ')).not.toMatch(/publish|delete/);
  });

  it('checks inputs', async () => {
    const { svc } = make();
    await expect(svc.call('create_draft', {}, 7)).rejects.toThrow(/title/);
    await expect(
      svc.call('create_draft', { title: 'x', coverColor: 'red' }, 7),
    ).rejects.toThrow(/coverColor/);
    await expect(
      svc.call(
        'create_draft',
        { title: 'x', headerImageUrl: 'http://a/b.png' },
        7,
      ),
    ).rejects.toThrow(/https/);
    await expect(
      svc.call(
        'request_image_upload',
        { fileName: 'a.gif', contentType: 'image/gif', fileSize: 10 },
        7,
      ),
    ).rejects.toThrow(/contentType/);
  });

  it('hands out an upload URL, never takes image bytes', async () => {
    const { svc } = make();
    const result: any = await svc.call(
      'request_image_upload',
      { fileName: 'flow.svg', contentType: 'image/svg+xml', fileSize: 2048 },
      7,
    );
    expect(result.presignedUrl).toBe('https://s3/put');
    expect(result.imageUrl).toBe('https://cdn/blog/a.png');
  });
});

describe('BlogAuthorKeyService.verify', () => {
  const make = (row: any, granted: string[], count = 0) => {
    const keys = {
      findOne: jest.fn(async () => row),
      update: jest.fn(),
    };
    const redis = {
      get: jest.fn(async () => String(count)),
      set: jest.fn(async () => undefined),
    };
    const permissions = { getUserPermissions: jest.fn(async () => granted) };
    return new BlogAuthorKeyService(
      keys as any,
      redis as any,
      permissions as any,
    );
  };
  const key = `${BLOG_AUTHOR_KEY_PREFIX}abc`;
  const row = {
    id: 'k1',
    ownerId: 7,
    keyHash: hashBlogAuthorKey(key),
    lastUsedAt: null,
  };

  it('accepts a live key whose owner can edit blogs', async () => {
    const svc = make(row, [PERMISSIONS.EDIT_BLOG]);
    await expect(svc.verify(`Bearer ${key}`)).resolves.toMatchObject({
      ownerId: 7,
    });
  });

  it('rejects a key without the prefix, a revoked or unknown key', async () => {
    await expect(
      make(row, [PERMISSIONS.EDIT_BLOG]).verify('Bearer nope'),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      make(null, [PERMISSIONS.EDIT_BLOG]).verify(`Bearer ${key}`),
    ).rejects.toThrow(/revoked/);
  });

  it('rejects when the owner lost the permission', async () => {
    await expect(make(row, []).verify(`Bearer ${key}`)).rejects.toThrow(
      /can no longer edit/,
    );
  });

  it('rate limits', async () => {
    await expect(
      make(row, [PERMISSIONS.EDIT_BLOG], 60).verify(`Bearer ${key}`),
    ).rejects.toThrow(/Too many/);
  });
});

describe('BlogAuthoringController MCP', () => {
  const res = () => {
    const r: any = {};
    r.status = jest.fn(() => r);
    r.json = jest.fn(() => r);
    r.end = jest.fn(() => r);
    return r;
  };
  const make = (verify: () => Promise<any>) => {
    const tools = {
      definitions: jest.fn(() => [{ name: 'blog_guide' }]),
      call: jest.fn(async () => ({ ok: true })),
    };
    const ctl = new BlogAuthoringController({ verify } as any, tools as any);
    return { ctl, tools };
  };

  it('answers 401 with a JSON-RPC error for a bad key', async () => {
    const { ctl } = make(async () => {
      throw new UnauthorizedException(
        'That key is not valid or has been revoked.',
      );
    });
    const r = res();
    await ctl.mcp('Bearer x', { jsonrpc: '2.0', id: 1, method: 'ping' }, r);
    expect(r.status).toHaveBeenCalledWith(401);
  });

  it('lists tools and calls them as the key owner', async () => {
    const { ctl, tools } = make(async () => ({ ownerId: 7 }));
    const r1 = res();
    await ctl.mcp(
      'Bearer x',
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      r1,
    );
    expect(r1.json.mock.calls[0][0].result.tools).toEqual([
      { name: 'blog_guide' },
    ]);
    const r2 = res();
    await ctl.mcp(
      'Bearer x',
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'blog_guide', arguments: {} },
      },
      r2,
    );
    expect(tools.call).toHaveBeenCalledWith('blog_guide', {}, 7);
    expect(r2.json.mock.calls[0][0].result.content[0].text).toContain(
      '"ok": true',
    );
  });

  it('reports a failing tool as a result the agent can read', async () => {
    const { ctl, tools } = make(async () => ({ ownerId: 7 }));
    tools.call.mockRejectedValueOnce(new Error('This post is published.'));
    const r = res();
    await ctl.mcp(
      'Bearer x',
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'update_draft', arguments: {} },
      },
      r,
    );
    const reply = r.json.mock.calls[0][0];
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0].text).toBe('This post is published.');
  });

  it('accepts notifications silently', async () => {
    const { ctl } = make(async () => ({ ownerId: 7 }));
    const r = res();
    await ctl.mcp(
      'Bearer x',
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      r,
    );
    expect(r.status).toHaveBeenCalledWith(202);
  });
});
