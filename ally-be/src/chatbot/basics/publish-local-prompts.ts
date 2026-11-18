/**
 * Publish approved prompt texts in a LOCAL Skills Store (Q3-fast: after a stop's approval, the
 * part's suite re-runs on exactly the approved text). Goes through the store's one write path,
 * `PromptVersioningService`: a new version on top of the newest, checked against the prompt's
 * contract, then promoted. Keeps the live version's model settings.
 *
 *   docker cp ally-ai/app/prompts/knowledge/crisis_classify.txt ally-be-app-1:/tmp/p1.txt
 *   docker exec -w /app ally-be-app-1 node dist/chatbot/basics/publish-local-prompts.js \
 *     --prompt ally_ai_knowledge_crisis_classify=/tmp/p1.txt [--prompt code=file …] \
 *     --note "Q3-fast stop 1, approved 18 Nov"
 *
 * Refuses a database whose name doesn't look local. Production prompts are published from the
 * Skills Store or with the `prompts` CLI, never with this.
 */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
loadEnv();

import { readFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { Prompt } from '../../prompt/entity/prompt.entity';
import {
  PromptVersion,
  PromptVersionSource,
} from '../../prompt/entity/prompt-version.entity';
import { PromptVersioningService } from '../../prompt/service/prompt-versioning.service';

const pairs = (): [string, string][] =>
  process.argv
    .flatMap((value, at, all) => (value === '--prompt' ? [all[at + 1]] : []))
    .map((pair) => pair.split('=') as [string, string]);

async function main(): Promise<void> {
  const noteAt = process.argv.indexOf('--note');
  const note = noteAt > 0 ? process.argv[noteAt + 1] : 'local publish';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const db = app.get(DataSource);
  const [{ name: database }] = await db.query(
    'SELECT current_database() AS name',
  );
  if (!/(_local|_test|_fresh)$/.test(database)) {
    throw new Error(
      `Refusing to publish in "${database}": not a local database`,
    );
  }
  const versioning = app.get(PromptVersioningService);
  for (const [code, file] of pairs()) {
    const prompt = await db.manager.findOneOrFail(Prompt, {
      where: { promptCode: code },
    });
    const live = await db.manager.findOne(PromptVersion, {
      where: { promptId: prompt.id, version: prompt.currentVersion ?? -1 },
    });
    const [{ latest }] = await db.query(
      `SELECT max(version) AS latest FROM prompts_versions WHERE "promptId" = $1`,
      [prompt.id],
    );
    const created = await versioning.createVersion(
      prompt.id,
      {
        body: readFileSync(file, 'utf8'),
        baseVersion: latest ?? null,
        provider: live?.provider ?? null,
        model: live?.model ?? null,
        temperature: live?.temperature ?? null,
        source: PromptVersionSource.CLI,
        note,
      },
      { translate: 'none' },
    );
    await versioning.promote(
      prompt.id,
      created.version,
      prompt.currentVersion ?? null,
      { requireTranslations: false },
    );
    console.log(`${code}: v${created.version} is live locally`);
  }
  await app.close();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
