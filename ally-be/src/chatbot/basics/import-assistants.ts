/**
 * Load real assistants exported from production (`scripts/q3/export-assistants.sql`) into a LOCAL
 * stack, for Q3-fast Part 2's diagnosis: each becomes a new assistant owned by `--owner`, with its
 * settings, its documents (indexed again, like a site read), the site reader's facts and the
 * owner's setup answers on a published draft, and its lists with the entries nobody made for a
 * person. The export holds no conversations, contacts or memory, so neither does the copy.
 *
 *   docker cp ~/ally-exports/q3-fast/assistants.jsonl ally-be-app-1:/tmp/assistants.jsonl
 *   docker exec -w /app ally-be-app-1 node dist/chatbot/basics/import-assistants.js \
 *     --file /tmp/assistants.jsonl --owner <local user id> --tenant <local tenant id>
 *
 * Prints each new assistant's id. Never run it against production: it refuses a database whose
 * name doesn't look local (`*_local`, `*_test`, `*_fresh`).
 */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
loadEnv();

import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { KbDocumentSourceType } from '../../knowledge-base/enum/knowledge-base.enum';
import { KnowledgeBaseService } from '../../knowledge-base/service/knowledge-base.service';

interface Exported {
  kind: 'assistant' | 'prompts';
  chatbot?: Record<string, unknown> & { name: string };
  documents?: {
    title: string;
    source_url: string | null;
    tags: string[] | null;
    raw_text: string | null;
  }[];
  draft?: Record<string, unknown> | null;
  lists?: {
    key: string;
    name: string;
    settings: unknown;
    agent_read: boolean;
    agent_write: boolean;
    fields: Record<string, unknown>[] | null;
    rules: { kind: string; config: unknown }[] | null;
    records: { id: string; data: Record<string, unknown> }[] | null;
  }[];
}

const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
};

/** Replaces every old record id in a record's data with its copy's id. */
const remap = (value: unknown, ids: Map<string, string>): unknown => {
  if (typeof value === 'string') return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => remap(v, ids));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, remap(v, ids)]),
    );
  }
  return value;
};

async function main(): Promise<void> {
  const file = arg('file');
  const owner = Number(arg('owner'));
  const tenant = arg('tenant') ?? '';
  if (!file || !owner) {
    throw new Error('--file and --owner are required');
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const db = app.get(DataSource);
  const [{ name: database }] = await db.query(
    'SELECT current_database() AS name',
  );
  if (!/(_local|_test|_fresh)$/.test(database)) {
    throw new Error(
      `Refusing to import into "${database}": not a local database`,
    );
  }
  const knowledge = app.get(KnowledgeBaseService);
  const lines = readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => JSON.parse(line) as Exported);

  for (const item of lines.filter((l) => l.kind === 'assistant')) {
    const id = randomUUID();
    try {
      await importOne(db, knowledge, item, id, owner, tenant);
    } catch (error) {
      // Never leave half a copy behind: archive whatever was made, then stop.
      await db.query(
        `UPDATE kb_documents SET archived_at = now() WHERE owner_chatbot_id = $1`,
        [id],
      );
      await db.query(`UPDATE chatbots SET archived_at = now() WHERE id = $1`, [
        id,
      ]);
      throw error;
    }
  }
  await comparePrompts(db, lines);
  await app.close();
  // The app's queue pollers would keep the process alive.
  process.exit(0);
}

async function importOne(
  db: DataSource,
  knowledge: KnowledgeBaseService,
  item: Exported,
  id: string,
  owner: number,
  tenant: string,
): Promise<void> {
  {
    const c = item.chatbot!;
    await db.query(
      `INSERT INTO chatbots (id, name, description, status, access_mode, answer_mode,
         knowledge_source, persona, model, settings, created_by, rules, safety_pack,
         safety_pack_version, purpose, purpose_note)
       VALUES ($1, $2, $3, 'live', 'anyone', $4, 'selected', $5, $6, $7, $8, $9, $10, $11,
         $12, $13)`,
      [
        id,
        `${c.name} (prod copy)`,
        c.description ?? null,
        c.answer_mode,
        c.persona ?? {},
        c.model ?? null,
        c.settings ?? {},
        owner,
        c.rules ?? { never: [] },
        c.safety_pack ?? null,
        c.safety_pack_version ?? null,
        c.purpose ?? null,
        c.purpose_note ?? null,
      ],
    );
    await db.query(
      `INSERT INTO chatbot_members (chatbot_id, user_id, role, roles, created_by) VALUES ($1, $2, 'owner', ARRAY['owner']::text[], $2)`,
      [id, owner],
    );

    // Documents, through the real ingest, so they are chunked and indexed as a site read is.
    const documentIds: string[] = [];
    await ExecutionManager.runWithContext(async () => {
      ExecutionManager.setAuthContext(String(owner), tenant);
      for (const doc of item.documents ?? []) {
        if (!doc.raw_text?.trim()) continue;
        const saved = await knowledge.createForChatbot(id, {
          sourceType: KbDocumentSourceType.PASTE,
          title: doc.title.slice(0, 300),
          text: doc.raw_text.slice(0, 200_000),
          sourceUrl: doc.source_url ?? undefined,
          tags: doc.tags ?? [],
        } as never);
        documentIds.push(saved.id);
        await db.query(
          `INSERT INTO chatbot_documents (chatbot_id, document_id, created_by) VALUES ($1, $2, $3)`,
          [id, saved.id, owner],
        );
      }
    });

    // The facts and setup answers, on a published draft, as setup leaves them.
    const draft = item.draft ?? {};
    await db.query(
      `INSERT INTO bot_drafts (owner_user_id, status, step, source, learned, industry,
         safety_pack, answers, draft_config, chatbot_id)
       VALUES ($1, 'published', 'published', $2, $3, $4, $5, $6, $7, $8)`,
      [
        owner,
        draft.source ?? {},
        draft.learned ?? { facts: [], dropped: 0 },
        draft.industry ?? null,
        draft.safety_pack ?? c.safety_pack ?? null,
        draft.answers ?? {},
        {
          ...((draft.draft_config as object) ?? {}),
          knowledgeDocumentIds: documentIds,
        },
        id,
      ],
    );

    // Lists: definitions first, then entries, with relations pointed at the copies.
    const recordIds = new Map<string, string>();
    for (const list of item.lists ?? []) {
      for (const record of list.records ?? [])
        recordIds.set(record.id, randomUUID());
    }
    for (const list of item.lists ?? []) {
      const [{ id: collectionId }] = await db.query(
        `INSERT INTO collections (chatbot_id, key, name, settings, agent_read, agent_write)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          id,
          list.key,
          list.name,
          list.settings ?? {},
          list.agent_read,
          list.agent_write,
        ],
      );
      for (const f of list.fields ?? []) {
        await db.query(
          `INSERT INTO collection_fields (collection_id, key, label, type, options, required,
             "default", privacy, agent_read, agent_write, position)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9, $10, $11)`,
          [
            collectionId,
            f.key,
            f.label,
            f.type,
            JSON.stringify(f.options ?? {}),
            f.required ?? false,
            // jsonb: a default of "booked" is the JSON string, not bare text.
            f.default === undefined || f.default === null
              ? null
              : JSON.stringify(f.default),
            f.privacy === undefined || f.privacy === null
              ? null
              : JSON.stringify(f.privacy),
            f.agent_read ?? true,
            f.agent_write ?? false,
            f.position ?? 0,
          ],
        );
      }
      for (const rule of list.rules ?? []) {
        await db.query(
          `INSERT INTO collection_constraints (collection_id, kind, config) VALUES ($1, $2, $3::jsonb)`,
          [collectionId, rule.kind, JSON.stringify(rule.config)],
        );
      }
      for (const record of list.records ?? []) {
        await db.query(
          `INSERT INTO collection_records (id, chatbot_id, collection_id, data, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            recordIds.get(record.id),
            id,
            collectionId,
            remap(record.data, recordIds),
            { kind: 'user', id: owner },
          ],
        );
      }
    }
    console.log(
      `${id}  ${c.name} (prod copy): ${documentIds.length} documents, ` +
        `${((draft.learned as { facts?: unknown[] })?.facts ?? []).length} facts, ` +
        `${(item.lists ?? []).length} lists`,
    );
  }
}

/**
 * Production's live prompts, compared with the local Skills Store: the diagnosis says which differ,
 * and runs with production's where they do.
 */
async function comparePrompts(
  db: DataSource,
  lines: Exported[],
): Promise<void> {
  const prompts = lines.find((l) => l.kind === 'prompts') as
    | { prompts?: { code: string; prompt: string }[] }
    | undefined;
  for (const p of prompts?.prompts ?? []) {
    const [local] = await db.query(
      `SELECT v.prompt FROM prompts p JOIN prompts_versions v
         ON v."promptId" = p.id AND v.version = p."currentVersion" WHERE p."promptCode" = $1`,
      [p.code],
    );
    if (!local || local.prompt !== p.prompt) {
      console.log(`prompt differs from local: ${p.code}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
