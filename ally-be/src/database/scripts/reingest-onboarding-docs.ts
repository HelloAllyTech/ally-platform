/**
 * Re-ingests onboarded assistants' pasted documents (crawled pages, Owner notes) so their
 * headings sit inside their sections (Agents v2 chunk 20a-2; the wrong declines in
 * docs/agents-v2/CHUNK-20A-EVAL.md).
 *
 * Only documents still chunked the old way are queued: a document needs it when one of its
 * sections has no chunk that starts with the section's heading. A re-ingested document has one,
 * so running this twice queues nothing the second time.
 *
 * Queued as `reindex`, which writes a new chunk version and deletes the old one (an `ingest` of
 * an indexed document keeps its version, so its old chunks would stay). For these documents a
 * reindex extracts again from the stored text, which is where the heading fix is.
 *
 * Logs counts and document ids only, never document text.
 *
 *   npm run reingest:onboarding-docs -- --dry-run     # count only
 *   npm run reingest:onboarding-docs                  # queue them
 */

import { config as loadEnv } from 'dotenv';
loadEnv();

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../data-source';

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * The queue message for one document. `reindex`, never `ingest`: an `ingest` of an indexed
 * document keeps its chunk version, so its old chunks would stay (found on the first local run).
 */
export const reindexMessage = (documentId: string) => ({
  documentId,
  action: 'reindex' as const,
});

/** Pasted documents of onboarded assistants (a safety pack is set only by onboarding). */
export const NEEDS_REINGEST_SQL = `
  SELECT d.id
    FROM kb_documents d
    LEFT JOIN chatbots c ON c.id = d.owner_chatbot_id
   WHERE d.source_type = 'paste'
     AND d.archived_at IS NULL
     AND d.raw_text IS NOT NULL
     AND (c.safety_pack IS NOT NULL OR 'onboarding' = ANY(d.tags))
     AND EXISTS (
       SELECT 1
         FROM kb_document_chunks k
        WHERE k.document_id = d.id
          AND k.section_path IS NOT NULL
        GROUP BY k.section_path
       HAVING NOT bool_or(left(k.text, length(k.section_path)) = k.section_path)
     )
   ORDER BY d.id`;

async function main(): Promise<void> {
  const queueUrl = process.env.SQS_KB_INGEST_QUEUE_URL;
  if (!DRY_RUN && !queueUrl) {
    throw new Error('SQS_KB_INGEST_QUEUE_URL is not set');
  }
  const dataSource = await new DataSource({
    ...dataSourceOptions,
    entities: [],
    migrations: [],
  }).initialize();
  try {
    const rows = await dataSource.query<{ id: string }[]>(NEEDS_REINGEST_SQL);
    console.log(
      `${rows.length} document(s) still chunked without their headings${DRY_RUN ? ' (dry run: nothing queued)' : ''}`,
    );
    if (DRY_RUN || !rows.length) return;
    const sqs = new SQSClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      ...(process.env.AWS_ENDPOINT_URL
        ? { endpoint: process.env.AWS_ENDPOINT_URL }
        : {}),
    });
    let queued = 0;
    for (const { id } of rows) {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(reindexMessage(id)),
        }),
      );
      queued += 1;
    }
    console.log(`Queued ${queued} document(s) for reindex`);
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      `Re-ingest failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    process.exit(1);
  });
}
