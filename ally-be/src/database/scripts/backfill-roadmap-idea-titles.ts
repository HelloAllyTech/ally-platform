/**
 * One-time backfill: give every existing roadmap idea a model-written title, with its text kept
 * as Summary > Problem.
 *
 * Why: until 2026-11-19 an idea's title was the first line of `description` and was never
 * required. A long single-line submission (OPP-0648) was cut mid-sentence at 200 characters
 * and its tail landed in the Problem. New ideas now carry a title of their own; this gives the
 * older ones one.
 *
 * What it writes, per idea (type 'idea', not deleted):
 *   - an idea stored as one block of text: `<new title>\n\n<the whole original text>`;
 *   - an idea that already has a title line and a body: the title is REPLACED by the new one and
 *     the body is kept as it is. The old title is in the report, so it can be put back.
 * and it marks the row's vector stale so the reconciliation sweep re-embeds it.
 *
 * Safe by default: without --apply nothing is written. Either way a report of every change
 * (id, code, before, after) is written to --report. An applied run records the ids it finished
 * in --state, so a second run, or one after a failure, skips them instead of stacking another
 * title on top. Revert one row with: UPDATE roadmap_opportunities SET description = <before>.
 *
 *   npm run backfill:roadmap-idea-titles -- --limit 5            # preview 5, writes nothing
 *   npm run backfill:roadmap-idea-titles -- --apply              # write all
 *
 * Flags: --apply, --limit N, --report <file>, --state <file>.
 */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
loadEnv();

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { ROADMAP_LIMITS } from '../../product-roadmap/constants/product-roadmap.constants';
import { retitled } from '../../product-roadmap/item/roadmap-item-query.util';
import { RoadmapAiService } from '../../product-roadmap/service/roadmap-ai.service';

const argValue = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};

const APPLY = process.argv.includes('--apply');
const LIMIT = Number(argValue('--limit', '0')) || 0;
const REPORT_FILE = argValue('--report', 'roadmap-idea-titles-report.json');
const STATE_FILE = argValue('--state', 'roadmap-idea-titles-state.json');
const CONCURRENCY = 4;

interface Row {
  id: string;
  code: string | null;
  description: string;
}

interface Change {
  id: string;
  code: string | null;
  before: string;
  after: string;
  title: string;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const dataSource = app.get(DataSource, { strict: false });
    const ai = app.get(RoadmapAiService, { strict: false });

    const done = new Set<string>(
      existsSync(STATE_FILE)
        ? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as string[])
        : [],
    );

    const rows: Row[] = (
      await dataSource.query(
        `SELECT id, code, description FROM "roadmap_opportunities"
          WHERE type = 'idea' AND "deletedAt" IS NULL
          ORDER BY "createdAt" ASC`,
      )
    ).filter((r: Row) => !done.has(r.id));
    const todo = LIMIT ? rows.slice(0, LIMIT) : rows;
    console.log(
      `${todo.length} idea(s) to title${LIMIT ? ` (limit ${LIMIT} of ${rows.length})` : ''}, ` +
        `${done.size} already done. ${APPLY ? 'APPLYING' : 'Preview only: pass --apply to write.'}`,
    );

    const changes: Change[] = [];
    let failed = 0;
    let cursor = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const row = todo[cursor++];
        if (!row) return;
        try {
          const title = await ai.suggestTitle(row.description);
          const after = retitled(row.description, title);
          if (!title || after.length > ROADMAP_LIMITS.STORED_TEXT_MAX) {
            throw new Error(
              `title ${title.length} chars, text ${after.length}`,
            );
          }
          changes.push({
            id: row.id,
            code: row.code,
            before: row.description,
            after,
            title,
          });
          if (APPLY) {
            await dataSource.query(
              `UPDATE "roadmap_opportunities"
                  SET description = $2, "embeddingStatus" = 'pending', "embeddingAttempts" = 0
                WHERE id = $1 AND description = $3`,
              [row.id, after, row.description],
            );
            done.add(row.id);
            writeFileSync(STATE_FILE, JSON.stringify([...done]));
          }
        } catch (error) {
          failed++;
          console.error(`${row.code ?? row.id}: ${(error as Error).message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    writeFileSync(REPORT_FILE, JSON.stringify(changes, null, 2));
    console.log(
      `${changes.length} ${APPLY ? 'written' : 'previewed'}, ${failed} failed. Report: ${REPORT_FILE}`,
    );
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
