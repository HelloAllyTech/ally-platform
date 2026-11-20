import { BadRequestException, HttpException } from '@nestjs/common';

import { BlogSuggestionStatus } from '../entity/blog-review.entity';
import { BlogStatus } from '../enum/blog-status.enum';
import { BlogReviewService } from '../service/blog-review.service';

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 1000);

const make = (
  over: { status?: BlogStatus; link?: any; count?: number; rate?: number } = {},
) => {
  const link =
    over.link === undefined
      ? {
          id: 'l1',
          blogId: 'p1',
          token: 'tok',
          expiresAt: future,
          revokedAt: null,
          createdAt: new Date(),
        }
      : over.link;
  const links = {
    findOne: jest.fn(async () => link),
    save: jest.fn(async (l: any) => ({ ...l, createdAt: new Date() })),
    create: jest.fn((l: any) => l),
    update: jest.fn(),
  };
  const suggestions = {
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => ({
      id: 's1',
      blogId: 'p1',
      status: BlogSuggestionStatus.OPEN,
    })),
    save: jest.fn(async (s: any) => ({ ...s, createdAt: new Date() })),
    create: jest.fn((s: any) => s),
    count: jest.fn(async () => over.count ?? 0),
  };
  const blogs = {
    getById: jest.fn(async () => ({
      id: 'p1',
      slug: 'a-post',
      status: over.status ?? BlogStatus.DRAFT,
    })),
  };
  const redis = {
    get: jest.fn(async () => String(over.rate ?? 0)),
    set: jest.fn(async () => undefined),
  };
  return {
    links,
    suggestions,
    svc: new BlogReviewService(
      links as any,
      suggestions as any,
      blogs as any,
      redis as any,
    ),
  };
};

describe('BlogReviewService', () => {
  it('creates a link for a draft, with a long random token, and returns the active one next time', async () => {
    const { svc, links } = make({ link: null });
    const made = await svc.createLink('p1', 30, 7);
    expect(made.token.length).toBeGreaterThanOrEqual(30);
    expect(links.create.mock.calls[0][0].expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 29 * 86_400_000,
    );
    const again = make();
    expect((await again.svc.createLink('p1', 7, 7)).token).toBe('tok');
    expect(again.links.save).not.toHaveBeenCalled();
  });

  it('does not make a link for a published post', async () => {
    const { svc } = make({ status: BlogStatus.PUBLISHED });
    await expect(svc.createLink('p1', 14, 7)).rejects.toThrow(
      /published and public/,
    );
  });

  it('keeps the expiry within 1 and 60 days', async () => {
    const { svc, links } = make({ link: null });
    await svc.createLink('p1', 9999, 7);
    expect(links.create.mock.calls[0][0].expiresAt.getTime()).toBeLessThan(
      Date.now() + 61 * 86_400_000,
    );
  });

  it('shows the draft through a valid link and says when it has been published', async () => {
    const draft = await make().svc.viewByToken('tok');
    expect(draft.status).toBe(BlogStatus.DRAFT);
    const published = await make({
      status: BlogStatus.PUBLISHED,
    }).svc.viewByToken('tok');
    expect(published).toMatchObject({
      status: BlogStatus.PUBLISHED,
      slug: 'a-post',
    });
  });

  it('refuses an unknown, revoked or expired link', async () => {
    await expect(make({ link: null }).svc.viewByToken('x')).rejects.toThrow(
      /not valid/,
    );
    await expect(
      make({
        link: { id: 'l1', blogId: 'p1', token: 'tok', expiresAt: past },
      }).svc.viewByToken('tok'),
    ).rejects.toThrow(/not valid/);
  });

  it('saves a suggestion as plain text with the limits applied', async () => {
    const { svc, suggestions } = make();
    await svc.addSuggestion(
      'tok',
      {
        name: '  Asha\u0000  ',
        comment: 'x'.repeat(5000),
        email: 'asha@x.org',
        quote: 'line',
      },
      '1.2.3.4',
    );
    const saved = suggestions.create.mock.calls[0][0];
    expect(saved.name).toBe('Asha');
    expect(saved.comment.length).toBe(2000);
    expect(saved.email).toBe('asha@x.org');
  });

  it('requires a name and a comment, and a sane email', async () => {
    const { svc } = make();
    await expect(
      svc.addSuggestion('tok', { comment: 'x' }, 'ip'),
    ).rejects.toThrow(/name/);
    await expect(svc.addSuggestion('tok', { name: 'A' }, 'ip')).rejects.toThrow(
      /comment/,
    );
    await expect(
      svc.addSuggestion(
        'tok',
        { name: 'A', comment: 'x', email: 'nope' },
        'ip',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('limits how fast one reviewer can send, and how many a link takes', async () => {
    await expect(
      make({ rate: 10 }).svc.addSuggestion(
        'tok',
        { name: 'A', comment: 'x' },
        'ip',
      ),
    ).rejects.toThrow(HttpException);
    await expect(
      make({ count: 200 }).svc.addSuggestion(
        'tok',
        { name: 'A', comment: 'x' },
        'ip',
      ),
    ).rejects.toThrow(/limit/);
  });

  it('takes no suggestions once the post is published', async () => {
    await expect(
      make({ status: BlogStatus.PUBLISHED }).svc.addSuggestion(
        'tok',
        { name: 'A', comment: 'x' },
        'ip',
      ),
    ).rejects.toThrow(/published/);
  });

  it('switches the link off and marks a suggestion done', async () => {
    const { svc, links, suggestions } = make();
    await svc.revokeLink('p1');
    expect(links.update).toHaveBeenCalled();
    const s = await svc.setSuggestionStatus(
      'p1',
      's1',
      BlogSuggestionStatus.RESOLVED,
    );
    expect(s.status).toBe(BlogSuggestionStatus.RESOLVED);
    expect(suggestions.save).toHaveBeenCalled();
  });
});
