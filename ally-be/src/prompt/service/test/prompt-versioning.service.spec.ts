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
      if (e === PromptTranslation) {
        // `sourceHash` is a plain value or an `In([...])` operator.
        const wanted = opts.where.sourceHash;
        const hashes: string[] = Array.isArray(wanted?._value)
          ? wanted._value
          : [wanted];
        return state.translations.filter((t) => hashes.includes(t.sourceHash));
      }
      if (e === PromptVersion) return state.versions;
      return [];
    }),
    delete: jest.fn(async (e: unknown, where: any) => {
      if (e === PromptVersion) {
        state.versions = state.versions.filter(
          (v) => v.id !== where.id || !!v.publishedAt,
        );
      }
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
  const promptShared = { invalidate: jest.fn() };
  const service = new PromptVersioningService(
    dataSource,
    translation as any,
    promptShared as any,
  );
  return { service, state, manager, translation, promptShared };
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
        errorCode: 'SKILLS_STORE_STALE_BASE',
        details: expect.objectContaining({ latestVersion: 2 }),
      }),
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('refuses text that breaks the contract with 422, naming what is wrong', async () => {
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
        errorCode: 'SKILLS_STORE_CONTRACT_VIOLATION',
        details: { missing: ['age'], unknown: ['mood'] },
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
    const { service, state, promptShared } = buildStore({
      prompt: { currentVersion: 1, model: 'old-model' },
      versions: candidate(),
    });

    const result = await service.promote('p1', 2, 1);

    expect(result).toEqual(
      expect.objectContaining({ version: 2, previousVersion: 1 }),
    );
    expect(state.prompt.currentVersion).toBe(2);
    expect(state.prompt.model).toBe('gpt-5');
    expect(promptShared.invalidate).toHaveBeenCalled();
    expect(state.versions[1].publishedAt).toBeInstanceOf(Date);
  });

  it('keeps every earlier version and its translations when one goes live', async () => {
    const history = Array.from({ length: 40 }, (_, i) => ({
      id: `v${i + 1}`,
      version: i + 1,
      prompt: `Text ${i + 1}`,
      publishedAt: new Date(),
    }));
    const { service, state, manager } = buildStore({
      prompt: { currentVersion: 40 },
      versions: [
        ...history,
        { id: 'v41', version: 41, prompt: 'Candidate', publishedAt: null },
      ],
    });

    await service.promote('p1', 41, 40);

    expect(state.prompt.currentVersion).toBe(41);
    expect(state.versions).toHaveLength(41);
    expect(manager.delete).not.toHaveBeenCalled();
    const deletes = manager.createQueryBuilder.mock.results
      .map((r: { value: any }) => r.value)
      .filter((q: any) => q.entity && q.execute.mock.calls.length);
    expect(deletes).toHaveLength(0);
  });

  it('refuses when the live version moved since the caller looked', async () => {
    const { service, state } = buildStore({
      prompt: { currentVersion: 1 },
      versions: candidate(),
    });

    await expect(service.promote('p1', 2, 0)).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'SKILLS_STORE_STALE_BASE',
      }),
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
        errorCode: 'SKILLS_STORE_TRANSLATIONS_PENDING',
        details: expect.objectContaining({ pending: [5] }),
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
      response: expect.objectContaining({
        errorCode: 'SKILLS_STORE_JUDGE_RUBRIC_PINNED',
      }),
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
      response: expect.objectContaining({
        errorCode: 'SKILLS_STORE_NOT_A_CANDIDATE',
      }),
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

  it('refuses a judge rubric before creating anything unless confirmed', async () => {
    const { service, state } = buildStore({
      prompt: {
        promptCode: 'drift_judge_conversation_rubric',
        currentVersion: 1,
      },
      versions: [
        { id: 'v1', version: 1, prompt: 'Live', publishedAt: new Date() },
      ],
    });

    await expect(
      service.createAndPromote(
        'p1',
        input({ baseVersion: 1, source: PromptVersionSource.REVERT }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'SKILLS_STORE_JUDGE_RUBRIC_PINNED',
      }),
    });
    expect(state.versions).toHaveLength(1);

    const result = await service.createAndPromote(
      'p1',
      input({ baseVersion: 1, source: PromptVersionSource.REVERT }),
      { confirmJudgeRubricChange: true },
    );
    expect(result.version).toBe(2);
    expect(state.prompt.currentVersion).toBe(2);
  });

  it('puts a judge rubric live without confirming when nothing was live yet', async () => {
    const { service, state } = buildStore({
      prompt: {
        promptCode: 'drift_judge_conversation_rubric',
        currentVersion: null as any,
      },
    });

    await service.createAndPromote('p1', input({ baseVersion: null }));

    expect(state.prompt.currentVersion).toBe(1);
  });

  it('removes the version it created when the promote is refused', async () => {
    const { service, state } = buildStore({
      prompt: {
        currentVersion: 1,
        translationEnabled: true,
        promptType: 'main_agent',
      },
      versions: [
        { id: 'v1', version: 1, prompt: 'Live', publishedAt: new Date() },
      ],
      // No translation rows: language 2 stays pending.
      languages: [2],
    });

    await expect(
      service.createAndPromote('p1', input({ baseVersion: 1 })),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        errorCode: 'SKILLS_STORE_TRANSLATIONS_PENDING',
      }),
    });
    expect(state.versions.map((v) => v.version)).toEqual([1]);
    expect(state.prompt.currentVersion).toBe(1);
  });
});

describe('PromptVersioningService.listVersions', () => {
  it('reads every unpublished body’s translations in one query', async () => {
    const { service, manager } = buildStore({
      prompt: {
        currentVersion: 2,
        translationEnabled: true,
        promptType: 'main_agent',
      },
      versions: [
        { id: 'v1', version: 1, prompt: 'Old', publishedAt: new Date() },
        { id: 'v2', version: 2, prompt: 'Live', publishedAt: new Date() },
        { id: 'v3', version: 3, prompt: 'Draft A', publishedAt: null },
        { id: 'v4', version: 4, prompt: 'Draft B', publishedAt: null },
      ],
      languages: [2],
      translations: [
        {
          languageId: 2,
          sourceHash: hashPromptBody('Draft A'),
          status: 'ready',
        } as any,
      ],
    });

    const versions = await service.listVersions('p1');

    const translationQueries = manager.find.mock.calls.filter(
      ([e]: [unknown]) => e === PromptTranslation,
    );
    expect(translationQueries).toHaveLength(1);
    const byVersion = new Map(versions.map((v) => [v.version, v]));
    expect(byVersion.get(3)!.translations!.ready).toEqual([2]);
    expect(byVersion.get(4)!.translations!.pending).toEqual([2]);
    expect(byVersion.get(2)!.translations!.pending).toEqual([2]);
    expect(byVersion.get(1)!.translations).toBeUndefined();
  });
});

describe('PromptVersioningService.getVersionBody', () => {
  it('returns one version’s text, or null for a missing or invalid version', async () => {
    const { service } = buildStore({
      prompt: { currentVersion: 1 },
      versions: [
        { id: 'v1', version: 1, prompt: 'Live', publishedAt: new Date() },
      ],
    });

    await expect(service.getVersionBody('p1', 1)).resolves.toBe('Live');
    await expect(service.getVersionBody('p1', 9)).resolves.toBeNull();
    await expect(service.getVersionBody('p1', NaN)).resolves.toBeNull();
  });
});

describe('PromptVersioningService.translateDrafts', () => {
  it('translates every unpublished draft, wherever it sits', async () => {
    const { service, manager, translation } = buildStore({
      prompt: { currentVersion: 3 },
      versions: [],
    });
    manager.find.mockResolvedValueOnce([
      { id: 'v2', version: 2, prompt: 'Never published', publishedAt: null },
      { id: 'v4', version: 4, prompt: 'Draft', publishedAt: null },
    ]);

    await service.translateDrafts('p1');

    expect(translation.translateBody).toHaveBeenCalledTimes(2);
    expect(translation.translateBody).toHaveBeenCalledWith(
      'p1',
      'Never published',
      'v2',
    );
    expect(translation.translateBody).toHaveBeenCalledWith('p1', 'Draft', 'v4');
  });
});
