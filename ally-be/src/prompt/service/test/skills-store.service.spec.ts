import { UnprocessableEntityException } from '@nestjs/common';
import {
  ExportedPrompt,
  ExportedVersion,
  SkillsStoreService,
} from '../skills-store.service';
import { Prompt } from '../../entity/prompt.entity';
import { PromptVersion } from '../../entity/prompt-version.entity';
import { hashPromptBody } from '../../util/prompt-contract.util';

const version = (over: Partial<ExportedVersion>): ExportedVersion => ({
  version: 1,
  prompt: 'Live text',
  contentHash: hashPromptBody(over.prompt ?? 'Live text'),
  provider: null,
  model: null,
  temperature: null,
  source: null,
  note: null,
  createdAt: new Date(),
  ...over,
});

const exported = (
  promptCode: string,
  over: Partial<ExportedPrompt> = {},
): ExportedPrompt => ({
  promptCode,
  name: promptCode,
  description: '',
  category: null,
  promptType: null,
  kind: null,
  hasStates: false,
  translationEnabled: false,
  availableVariables: null,
  contract: null,
  latestVersion: 1,
  live: version({}),
  latest: version({}),
  candidates: [],
  translations: [],
  ...over,
});

/**
 * Every prompt already exists locally with its live text matching the export,
 * so the import only has candidates (or a refusal) to deal with.
 */
function buildService(localVersions: Record<string, PromptVersion[]>) {
  const prompts: Record<string, Prompt> = Object.fromEntries(
    Object.keys(localVersions).map((code) => [
      code,
      { id: `id-${code}`, promptCode: code, currentVersion: 1 } as Prompt,
    ]),
  );
  const manager: any = {
    findOne: jest.fn(async (e: unknown, opts: any) => {
      if (e === Prompt) return prompts[opts.where.promptCode] ?? null;
      if (e === PromptVersion) {
        const code = opts.where.promptId.replace('id-', '');
        return (
          localVersions[code]?.find((v) => v.version === opts.where.version) ??
          null
        );
      }
      return null;
    }),
    find: jest.fn(async (e: unknown, opts: any) => {
      if (e === PromptVersion) {
        return localVersions[opts.where.promptId.replace('id-', '')] ?? [];
      }
      return [];
    }),
    update: jest.fn(),
    upsert: jest.fn(),
  };
  const versioning = {
    createVersion: jest.fn(async (promptId: string, input: any) => {
      const code = promptId.replace('id-', '');
      const list = localVersions[code];
      const created = {
        id: `${code}-v${list.length + 1}`,
        version: list.length + 1,
        prompt: input.body,
        provider: input.provider ?? null,
        model: input.model ?? null,
        temperature: input.temperature ?? null,
      } as PromptVersion;
      list.push(created);
      return created;
    }),
    promote: jest.fn(),
    latestVersionOf: jest.fn(async (promptId: string) => {
      return localVersions[promptId.replace('id-', '')].length;
    }),
  };
  const service = new SkillsStoreService({ manager } as any, versioning as any);
  return { service, versioning };
}

describe('SkillsStoreService.import', () => {
  const live = { id: 'v1', version: 1, prompt: 'Live text' } as PromptVersion;
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.SKILLS_STORE_IMPORT_ENABLED;
    process.env.SKILLS_STORE_IMPORT_ENABLED = 'true';
  });
  afterEach(() => {
    process.env.SKILLS_STORE_IMPORT_ENABLED = previous;
  });

  it('does not import a draft that is already here, so repeat imports add nothing', async () => {
    const versions = { a: [{ ...live }] };
    const { service } = buildService(versions);
    const payload = {
      exportedAt: '2026-10-24T00:00:00Z',
      prompts: [
        exported('a', {
          candidates: [
            version({ version: 2, prompt: 'Draft' }),
            version({ version: 3, prompt: 'Draft', model: 'gpt-5' }),
          ],
        }),
      ],
    };

    const first = await service.import(payload);
    const second = await service.import(payload);

    expect(first.candidates).toBe(2); // same text, different model: two drafts
    expect(second.candidates).toBe(0);
    expect(versions.a).toHaveLength(3);
  });

  it('keeps importing after one prompt is refused, and names it', async () => {
    const versions = {
      a: [{ ...live }],
      b: [{ ...live }],
      c: [{ ...live }],
    };
    const { service, versioning } = buildService(versions);
    versioning.createVersion.mockImplementation(
      async (promptId: string, input: any) => {
        if (promptId === 'id-b') {
          throw new UnprocessableEntityException(
            "This text breaks the prompt's contract: missing required {name}.",
          );
        }
        const list = versions[promptId.replace('id-', '') as 'a' | 'c'];
        const created = {
          id: `x${list.length + 1}`,
          version: list.length + 1,
          prompt: input.body,
        } as PromptVersion;
        list.push(created);
        return created;
      },
    );
    const draft = [version({ version: 2, prompt: 'Draft' })];

    const result = await service.import({
      exportedAt: '2026-10-24T00:00:00Z',
      prompts: [
        exported('a', { candidates: draft }),
        exported('b', { candidates: draft }),
        exported('c', { candidates: draft }),
      ],
    });

    expect(result.candidates).toBe(2);
    expect(result.failed).toEqual([
      {
        promptCode: 'b',
        error:
          "This text breaks the prompt's contract: missing required {name}.",
      },
    ]);
    expect(versions.c).toHaveLength(2);
  });
});
