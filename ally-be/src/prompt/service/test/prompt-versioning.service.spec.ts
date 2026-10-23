import { PromptVersioningService } from '../prompt-versioning.service';
import { Prompt } from '../../entity/prompt.entity';
import {
  PromptVersion,
  PromptVersionSource,
} from '../../entity/prompt-version.entity';
import { PromptTranslation } from '../../entity/prompt-translation.entity';
import { hashPromptBody } from '../../util/prompt-contract.util';

/**
 * A fake TypeORM manager over an in-memory prompt, its versions and its
 * translations — enough to drive the write path's transaction for real
 * instead of mocking the service under test.
 */
function buildStore(initial: {
  prompt: Partial<Prompt>;
  versions?: Array<Partial<PromptVersion>>;
  translations?: Array<Partial<PromptTranslation>>;
  languages?: number[];
}) {
  const state = {
    prompt: {
      id: 'p1',
      promptCode: 'some_prompt',
      ...initial.prompt,
    } as Prompt,
    versions: (initial.versions ?? []).map((v) => ({
      ...v,
    })) as PromptVersion[],
    translations: (initial.translations ?? []) as PromptTranslation[],
  };
  const qb = (entity?: unknown) => {
    const q: any = {
      setLock: () => q,
      where: () => q,
      andWhere: () => q,
      select: () => q,
      delete: () => q,
      from: (e: unknown) => {
        q.entity = e;
        return q;
      },
      getOne: async () => (entity === Prompt ? { ...state.prompt } : null),
      getRawOne: async () => ({
        max: state.versions.length
          ? Math.max(...state.versions.map((v) => v.version))
          : null,
      }),
      execute: jest.fn(async () => ({ affected: 0 })),
    };
    return q;
  };
  const manager: any = {
    createQueryBuilder: jest.fn((entity?: unknown) => qb(entity)),
    create: (_e: unknown, v: object) => ({ ...v }),
    save: jest.fn(async (_e: unknown, v: PromptVersion) => {
      const saved = { ...v, id: `v${v.version}`, createdAt: new Date() };
      state.versions.push(saved as PromptVersion);
      return saved;
    }),
    findOne: jest.fn(async (e: unknown, opts: any) => {
      if (e === Prompt) return { ...state.prompt };
      if (e === PromptVersion)
        return (
          state.versions.find((v) => v.version === opts.where.version) ?? null
        );
      return null;
    }),
    find: jest.fn(async (e: unknown, opts: any) => {
      if (e === PromptTranslation)
        return state.translations.filter(
          (t) => t.sourceHash === opts.where.sourceHash,
        );
      if (e === PromptVersion) return state.versions;
      return [];
    }),
    update: jest.fn(async (e: unknown, id: string, values: object) => {
      if (e === Prompt) Object.assign(state.prompt, values);
      if (e === PromptVersion) {
        const v = state.versions.find((x) => x.id === id);
        if (v) Object.assign(v, values);
      }
    }),
  };
  const dataSource: any = {
    manager,
    transaction: jest.fn(async (work: (m: unknown) => unknown) =>
      work(manager),
    ),
  };
  const translation = {
    translateBody: jest.fn().mockResolvedValue({ eligible: false }),
    getEligibleTargetLanguages: jest
      .fn()
      .mockResolvedValue((initial.languages ?? []).map((id) => ({ id }))),
  };
  const service = new PromptVersioningService(dataSource, translation as any);
  return { service, state, manager, translation };
}

const input = (over: Record<string, unknown> = {}) => ({
  body: 'New text {name}',
  baseVersion: 2 as number | null,
  source: PromptVersionSource.DASHBOARD,
  createdBy: 7,
  ...over,
});

describe('PromptVersioningService.createVersion', () => {
  const twoVersions = [
    { id: 'v1', version: 1, prompt: 'One', publishedAt: new Date() },
    { id: 'v2', version: 2, prompt: 'Two', publishedAt: new Date() },
  ];

  it('adds a candidate after the newest version, without touching what is live', async () => {
    const { service, state } = buildStore({
      prompt: { currentVersion: 2 },
      versions: twoVersions,
    });

    const created = await service.createVersion(
      'p1',
      input({ model: 'gpt-5' }),
    );

    expect(created).toEqual(
      expect.objectContaining({
        version: 3,
        prompt: 'New text {name}',
        model: 'gpt-5',
        contentHash: hashPromptBody('New text {name}'),
        publishedAt: null,
        source: 'dashboard',
      }),
    );
    expect(state.prompt.currentVersion).toBe(2);
  });

  it('refuses a write from a stale base with 409 stale_base, writing nothing', async () => {
    const { service, manager } = buildStore({
      prompt: { currentVersion: 2 },
      versions: twoVersions,
    });

    await expect(
      service.createVersion('p1', input({ baseVersion: 1 })),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'stale_base',
        latestVersion: 2,
      }),
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('refuses text that breaks the contract with 422 contract_violation', async () => {
    const { service } = buildStore({
      prompt: {
        currentVersion: 2,
        contract: { variables: ['name', 'age'], required: ['age'] },
      },
      versions: twoVersions,
    });

    await expect(
      service.createVersion('p1', input({ body: 'Hi {name} {mood}' })),
    ).rejects.toMatchObject({
      status: 422,
      response: expect.objectContaining({
        code: 'contract_violation',
        missing: ['age'],
        unknown: ['mood'],
      }),
    });
  });

  it('refuses a change to a gated Builder prompt unless the eval approved it', async () => {
    const { service } = buildStore({
      prompt: { promptCode: 'builder_interviewer_system', currentVersion: 2 },
      versions: twoVersions,
    });

    await expect(service.createVersion('p1', input())).rejects.toThrow(
      /replay eval/,
    );
    await expect(
      service.createVersion('p1', input({ evalApproved: true })),
    ).resolves.toEqual(expect.objectContaining({ version: 3 }));
  });

  it('starts translating the candidate in the background', async () => {
    const { service, translation } = buildStore({
      prompt: { currentVersion: 2 },
      versions: twoVersions,
    });

    const created = await service.createVersion('p1', input());

    expect(translation.translateBody).toHaveBeenCalledWith(
      'p1',
      'New text {name}',
      created.id,
    );
  });
});

describe('PromptVersioningService.promote', () => {
  const candidate = (body = 'Candidate') => [
    { id: 'v1', version: 1, prompt: 'Live', publishedAt: new Date() },
    { id: 'v2', version: 2, prompt: body, publishedAt: null, model: 'gpt-5' },
  ];

  it('moves the live pointer and mirrors the version settings onto the row', async () => {
    const { service, state } = buildStore({
      prompt: { currentVersion: 1, model: 'old-model' },
      versions: candidate(),
    });

    const result = await service.promote('p1', 2, 1);

    expect(result).toEqual(
      expect.objectContaining({ version: 2, previousVersion: 1 }),
    );
    expect(state.prompt.currentVersion).toBe(2);
    expect(state.prompt.model).toBe('gpt-5');
    expect(state.versions[1].publishedAt).toBeInstanceOf(Date);
  });

  it('refuses when the live version moved since the caller looked', async () => {
    const { service, state } = buildStore({
      prompt: { currentVersion: 1 },
      versions: candidate(),
    });

    await expect(service.promote('p1', 2, 0)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'stale_base' }),
    });
    expect(state.prompt.currentVersion).toBe(1);
  });

  it('waits while a translation of the candidate is still pending', async () => {
    const hash = hashPromptBody('Candidate');
    const { service, state } = buildStore({
      prompt: {
        currentVersion: 1,
        translationEnabled: true,
        promptType: 'main_agent',
      },
      versions: candidate(),
      languages: [2, 5],
      translations: [
        { languageId: 2, sourceHash: hash, status: 'ready' } as any,
      ],
    });

    await expect(service.promote('p1', 2, 1)).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'translations_pending',
        pending: [5],
      }),
    });
    expect(state.prompt.currentVersion).toBe(1);
  });

  it('goes live with a failed translation, reporting it so that language keeps English', async () => {
    const hash = hashPromptBody('Candidate');
    const { service, state } = buildStore({
      prompt: {
        currentVersion: 1,
        translationEnabled: true,
        promptType: 'main_agent',
      },
      versions: candidate(),
      languages: [2, 5],
      translations: [
        { languageId: 2, sourceHash: hash, status: 'ready' } as any,
        {
          languageId: 5,
          sourceHash: hash,
          status: 'failed',
          error: 'token mismatch',
        } as any,
      ],
    });

    const result = await service.promote('p1', 2, 1);

    expect(state.prompt.currentVersion).toBe(2);
    expect(result.failedLanguages).toEqual([
      { languageId: 5, error: 'token mismatch' },
    ]);
  });

  it('refuses a new judge rubric unless the label bump is confirmed', async () => {
    const { service, state } = buildStore({
      prompt: {
        promptCode: 'drift_judge_conversation_rubric',
        currentVersion: 1,
      },
      versions: candidate(),
    });

    await expect(service.promote('p1', 2, 1)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'judge_rubric_pinned' }),
    });
    await service.promote('p1', 2, 1, { confirmJudgeRubricChange: true });
    expect(state.prompt.currentVersion).toBe(2);
  });

  it('refuses to put an earlier published version live again unless rolling back', async () => {
    const { service } = buildStore({
      prompt: { currentVersion: 2 },
      versions: [
        { id: 'v1', version: 1, prompt: 'Old', publishedAt: new Date() },
        { id: 'v2', version: 2, prompt: 'Live', publishedAt: new Date() },
      ],
    });

    await expect(service.promote('p1', 1, 2)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'not_a_candidate' }),
    });
    await expect(
      service.promote('p1', 1, 2, { allowRollback: true }),
    ).resolves.toEqual(expect.objectContaining({ version: 1 }));
  });
});

describe('PromptVersioningService.createAndPromote', () => {
  it('translates in the foreground, then puts the version live', async () => {
    const { service, state, translation } = buildStore({
      prompt: { currentVersion: 1 },
      versions: [
        { id: 'v1', version: 1, prompt: 'Live', publishedAt: new Date() },
      ],
    });

    const result = await service.createAndPromote(
      'p1',
      input({ baseVersion: 1, source: PromptVersionSource.REVERT }),
    );

    expect(translation.translateBody).toHaveBeenCalledTimes(1);
    expect(result.version).toBe(2);
    expect(state.prompt.currentVersion).toBe(2);
  });
});
