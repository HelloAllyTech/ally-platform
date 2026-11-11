/**
 * Image Studio eval: renders a small fixed set (golden.json) through each
 * route you name, checks every image with the same vision judge production
 * uses, and writes a scorecard plus the images, so a model or style change is
 * a comparison and not a guess. docs/image-studio.md.
 *
 *   npx ts-node -r tsconfig-paths/register src/image-studio/scripts/eval.ts \
 *     --routes openai:gpt-image-1.5,gemini:gemini-2.5-flash-image \
 *     --styles cinematic_photo,graphic_novel [--only covers|sequences] [--out ./image-eval]
 *
 * Spends real money: roughly (covers + sequences × (cast + 5)) × routes × styles
 * images. Needs OPENAI_API_KEY (also for the judge) and/or GEMINI_API_KEY in
 * ally-be/.env. Writes nothing to S3 or the database.
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { AppConfigService } from 'src/config/config.service';
import { GeminiImageProvider } from 'src/image-generation/provider/gemini-image.provider';
import { OpenAiImageProvider } from 'src/image-generation/provider/openai-image.provider';
import { ImageGenerationProvider } from 'src/image-generation/interface/image-generation-provider.interface';
import {
  getSlotProfile,
  ImageSlotKind,
} from 'src/image-studio/constants/image-slots.constants';
import { findImageStyle } from 'src/image-studio/constants/image-styles.constants';
import { estimateImageCostUsd } from 'src/image-studio/constants/image-studio.constants';
import { ImageJudgeService } from 'src/image-studio/service/image-judge.service';
import { ImagePostprocessService } from 'src/image-studio/service/image-postprocess.service';
import { compileImagePrompt } from 'src/image-studio/util/image-prompt.compiler';
import { StoredImageReference } from 'src/image-studio/entity/generated-image.entity';

dotenv.config();

interface Golden {
  covers: { id: string; slotKind: ImageSlotKind; description: string }[];
  sequences: {
    id: string;
    cast: { id: string; name: string; appearance: string }[];
    setting: string;
    scenes: string[];
  }[];
}

interface Result {
  route: string;
  style: string;
  case: string;
  ms: number;
  costUsd: number;
  passed: boolean | null;
  issues: string[];
  error?: string;
}

const arg = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};

const config = new AppConfigService(new ConfigService(process.env));
const postprocess = new ImagePostprocessService();
const judgeTemplate = fs.readFileSync(
  path.join(__dirname, '../../prompts/image_studio/judge.txt'),
  'utf8',
);
const judge = new ImageJudgeService(
  config,
  { getPromptByCode: async () => judgeTemplate } as any,
  { record: async () => undefined } as any,
);

const providerFor = (
  route: string,
): { provider: ImageGenerationProvider; model: string } => {
  const [type, model] = route.split(':');
  const provider =
    type === 'gemini'
      ? new GeminiImageProvider(config)
      : new OpenAiImageProvider(config);
  provider.assertConfigured();
  return { provider, model: model || provider.getModel() };
};

async function render(
  route: string,
  styleId: string,
  slotKind: ImageSlotKind,
  description: string,
  cast: { id: string; name: string; appearance: string }[],
  references: {
    label: string;
    role: StoredImageReference['role'];
    data: Buffer;
  }[],
  outFile: string,
): Promise<{
  image?: Buffer;
  result: Omit<Result, 'route' | 'style' | 'case'>;
}> {
  const { provider, model } = providerFor(route);
  const slot = getSlotProfile(slotKind);
  const style = findImageStyle(styleId)!;
  const usable = references.slice(0, provider.maxReferences());
  const prompt = compileImagePrompt({
    slot,
    style,
    description,
    cast: cast.map((member) => ({ ...member })),
    references: usable.map((reference) => ({
      role: reference.role,
      label: reference.label,
    })),
  });
  const started = Date.now();
  try {
    const raw = await provider.generateImage(prompt, slot.providerSize, {
      quality: config.imageStudio.quality,
      model,
      ...(usable.length
        ? {
            references: usable.map((r) => ({
              data: r.data,
              mimeType: 'image/png' as const,
            })),
          }
        : {}),
    });
    const ms = Date.now() - started;
    const processed = await postprocess.process(raw, slot);
    fs.writeFileSync(outFile, processed.display);
    const check = await judge.check({
      image: await postprocess.toReference(raw),
      references: usable.map((r) => r.data),
      description,
      castNames: cast.map((member) => member.name),
    });
    return {
      image: processed.original,
      result: {
        ms,
        costUsd: estimateImageCostUsd(
          model,
          config.imageStudio.quality,
          usable.length,
        ),
        passed: check ? check.passed : null,
        issues: check?.issues ?? [],
      },
    };
  } catch (error) {
    return {
      result: {
        ms: Date.now() - started,
        costUsd: 0,
        passed: false,
        issues: [],
        error: (error as Error)?.message ?? String(error),
      },
    };
  }
}

async function main() {
  const golden: Golden = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'golden.json'), 'utf8'),
  );
  const routes = (arg('routes', 'openai') as string).split(',');
  const styles = (arg('styles', 'cinematic_photo') as string).split(',');
  const only = arg('only');
  const out = path.resolve(arg('out', './image-eval') as string);
  fs.mkdirSync(out, { recursive: true });
  const results: Result[] = [];

  for (const route of routes) {
    for (const style of styles) {
      const dir = path.join(out, `${route.replace(/[:/]/g, '_')}__${style}`);
      fs.mkdirSync(dir, { recursive: true });

      if (only !== 'sequences') {
        for (const cover of golden.covers) {
          const { result } = await render(
            route,
            style,
            cover.slotKind,
            cover.description,
            [],
            [],
            path.join(dir, `${cover.id}.webp`),
          );
          results.push({ route, style, case: cover.id, ...result });
          console.log(
            route,
            style,
            cover.id,
            result.passed,
            result.error ?? '',
          );
        }
      }

      if (only !== 'covers') {
        for (const sequence of golden.sequences) {
          // Cast sheets first: these are what keep each person the same.
          const sheets: { label: string; role: 'character'; data: Buffer }[] =
            [];
          for (const member of sequence.cast) {
            const { image, result } = await render(
              route,
              style,
              ImageSlotKind.CAST_SHEET,
              `${member.name}, ${member.appearance}`,
              [member],
              [],
              path.join(dir, `${sequence.id}-sheet-${member.id}.webp`),
            );
            results.push({
              route,
              style,
              case: `${sequence.id}/sheet-${member.id}`,
              ...result,
            });
            if (image)
              sheets.push({
                label: member.name,
                role: 'character',
                data: await postprocess.toReference(image),
              });
          }
          for (const [index, scene] of sequence.scenes.entries()) {
            const { result } = await render(
              route,
              style,
              ImageSlotKind.SCENE,
              `${scene} Setting: ${sequence.setting}.`,
              sequence.cast,
              sheets,
              path.join(dir, `${sequence.id}-scene-${index + 1}.webp`),
            );
            results.push({
              route,
              style,
              case: `${sequence.id}/scene-${index + 1}`,
              ...result,
            });
            console.log(
              route,
              style,
              sequence.id,
              index + 1,
              result.passed,
              result.error ?? '',
            );
          }
        }
      }
    }
  }

  const rows = new Map<string, Result[]>();
  for (const result of results) {
    const key = `${result.route} · ${result.style}`;
    rows.set(key, [...(rows.get(key) ?? []), result]);
  }
  const lines = [
    `# Image Studio eval — ${new Date().toISOString()}`,
    '',
    '| Route · style | Images | Passed check | Failed check | Errors | Median s | Est. cost |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const [key, list] of rows) {
    const ok = list.filter((r) => !r.error);
    const times = ok.map((r) => r.ms).sort((a, b) => a - b);
    const median = times.length
      ? times[Math.floor(times.length / 2)] / 1000
      : 0;
    lines.push(
      `| ${key} | ${list.length} | ${ok.filter((r) => r.passed === true).length} | ${ok.filter((r) => r.passed === false).length} | ${list.length - ok.length} | ${median.toFixed(1)} | $${list.reduce((sum, r) => sum + r.costUsd, 0).toFixed(2)} |`,
    );
  }
  lines.push('', '## Issues', '');
  for (const result of results.filter((r) => r.error || r.issues.length)) {
    lines.push(
      `- **${result.route} · ${result.style} · ${result.case}**: ${result.error ?? result.issues.join(' ')}`,
    );
  }
  lines.push(
    '',
    'Look at the images too: the judge catches text, missing people and unsafe content, not taste.',
  );
  fs.writeFileSync(path.join(out, 'scorecard.md'), lines.join('\n'));
  fs.writeFileSync(
    path.join(out, 'results.json'),
    JSON.stringify(results, null, 2),
  );
  console.log(`\nScorecard: ${path.join(out, 'scorecard.md')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
