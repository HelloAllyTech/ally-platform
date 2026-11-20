/**
 * One-off backfill: every manual scribe note (`callInfo.mode = 'DICTATION'`)
 * saved before 18a5fe14d2 (2026-11-13, "a manual note's call duration
 * reflects the real dictation length, not zero") has `call_details
 * .callDuration` permanently stuck at 0 — `chat.startedAt`/`endedAt` were
 * both set to the note's creation instant and never advanced, and the raw
 * audio was never persisted anywhere (VoiceNoteService holds it in memory
 * only), so the real recorded length cannot be recovered.
 *
 * This estimates it instead, from the one thing that *was* kept: the saved
 * transcript. Word count / DEFAULT_WPM (a plain speaking-rate guess, not a
 * measurement) gives a plausible duration so these notes stop claiming to be
 * instant. Each backfilled row is marked `callInfo.callDurationEstimated:
 * true` so an estimate is never confused with a real recording later, and so
 * a second run only touches rows a prior run didn't reach.
 *
 *   npm run backfill:dictation-note-duration -- --dry-run     # preview only
 *   npm run backfill:dictation-note-duration -- --limit 5     # first 5 pending rows
 *   npm run backfill:dictation-note-duration -- --wpm 150     # override the speaking-rate guess
 *   npm run backfill:dictation-note-duration                  # full run
 */

import { config as loadEnv } from 'dotenv';
loadEnv();

import * as crypto from 'crypto';
import { DataSource } from 'typeorm';

/** Plain speaking-rate guess for dictated notes — not a measurement. */
const DEFAULT_WPM = 130;
const BACKFILL_FLAG = 'callDurationEstimated';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  if (i === -1) return undefined;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
})();
const WPM = (() => {
  const i = process.argv.indexOf('--wpm');
  if (i === -1) return DEFAULT_WPM;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WPM;
})();

function buildDataSource(): DataSource {
  const database = process.env.DB_DATABASE;
  if (!database) {
    throw new Error('DB_DATABASE is not defined. Did you load your .env file?');
  }
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database,
    entities: [],
    synchronize: false,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    logging: false,
  });
}

/** Mirrors CryptoService.decrypt (aes-256-gcm, 12-byte IV + 16-byte tag + ciphertext, base64). */
function decrypt(encryptedData: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error(
      'PHI_DATA_ENCRYPTION_KEY must be 32 bytes (hex-encoded 64 chars)',
    );
  }
  const combined = Buffer.from(encryptedData, 'base64');
  const iv = combined.subarray(0, 12);
  const tag = combined.subarray(12, 28);
  const encrypted = combined.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
}

function estimateSeconds(transcript: string, wpm: number): number {
  const words = transcript.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / wpm) * 60));
}

async function main() {
  const encryptionKey = process.env.PHI_DATA_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error(
      'PHI_DATA_ENCRYPTION_KEY is not set — did you load your .env file?',
    );
  }

  const ds = buildDataSource();
  await ds.initialize();
  try {
    const candidates: Array<{
      id: number;
      chatId: number;
      transcript: string;
      callInfo: Record<string, any> | null;
    }> = await ds.query(`
      SELECT id, "chatId", transcript, "callInfo"
      FROM call_details
      WHERE (("callDuration" IS NULL) OR ("callDuration" = 0))
        AND transcript IS NOT NULL
        AND "callInfo" ->> 'mode' = 'DICTATION'
        AND COALESCE("callInfo" ->> '${BACKFILL_FLAG}', 'false') != 'true'
      ORDER BY id ASC
    `);

    const targets = LIMIT ? candidates.slice(0, LIMIT) : candidates;
    console.log(
      `[backfill] ${candidates.length} dictation note(s) with a zero/missing duration, ` +
        `processing ${targets.length} at ${WPM} wpm${DRY_RUN ? ' (dry run)' : ''}.`,
    );

    let succeeded = 0;
    let failed = 0;
    for (const row of targets) {
      try {
        const transcript = decrypt(row.transcript, encryptionKey);
        const seconds = estimateSeconds(transcript, WPM);
        console.log(
          `[backfill] chat ${row.chatId} (call_details ${row.id}): ` +
            `${transcript.trim().split(/\s+/).filter(Boolean).length} words -> ~${seconds}s`,
        );
        if (!DRY_RUN) {
          await ds.query(
            `
            UPDATE call_details
            SET "callDuration" = $1,
                "callInfo" = COALESCE("callInfo", '{}'::jsonb) || jsonb_build_object('${BACKFILL_FLAG}', true),
                "updatedAt" = now()
            WHERE id = $2
            `,
            [seconds, row.id],
          );
        }
        succeeded += 1;
      } catch (err) {
        failed += 1;
        console.error(
          `[backfill] FAILED for call_details ${row.id} (chat ${row.chatId}):`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    console.log(
      `\n[backfill] done. ${succeeded} succeeded, ${failed} failed${DRY_RUN ? ' (dry run — nothing written)' : ''}.`,
    );
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
