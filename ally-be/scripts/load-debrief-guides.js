// Load Ally's own Debrief Guidance entries (the style guide and the level guides) into the
// Context Library as platform-wide, pinned, authored entries. Idempotent: an entry whose
// statement already exists in Debrief Guidance is updated in place, never duplicated.
//
// Source: docs/debrief-harness/guidance/debrief-guides.json (reviewed in git).
// Usage, from a built ally-be (`npm run build`), local or inside the prod container:
//   node scripts/load-debrief-guides.js <path to debrief-guides.json> [--apply | --archive]
// Without a flag it prints what it would do and writes nothing. --archive takes the file's
// entries out of retrieval (archived, history kept). An entry may carry `tenantIds` to target
// organisations; without it the entry is platform-wide.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const req = (p) => require(path.join(ROOT, p));

(async () => {
  const [file, flag] = process.argv.slice(2);
  if (!file) throw new Error('usage: load-debrief-guides.js <json> [--apply]');
  const apply = flag === '--apply';
  const archive = flag === '--archive';
  const { entries } = JSON.parse(fs.readFileSync(file, 'utf8'));

  const { NestFactory } = req('node_modules/@nestjs/core');
  const { AppModule } = req('dist/app.module');
  const { ContextChunkService } = req(
    'dist/context-library/service/context-chunk.service',
  );
  const { DataSource } = req('node_modules/typeorm');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const chunks = app.get(ContextChunkService);
  const ds = app.get(DataSource);

  const existing = new Map(
    (
      await ds.query(
        `SELECT code, statement FROM cl_chunks WHERE collection_id = 'debrief_guidance' AND status = 'active'`,
      )
    ).map((r) => [r.statement, r.code]),
  );
  const actor = { userId: null, tenantId: null };
  if (archive) {
    const { ClChunkStatus } = req(
      'dist/context-library/enum/context-library.enum',
    );
    for (const e of entries) {
      const code = existing.get(e.statement);
      if (!code) {
        console.log(`not active  ${e.key}`);
        continue;
      }
      await chunks.setStatus(code, ClChunkStatus.ARCHIVED, actor);
      console.log(`archived ${code}  ${e.key}`);
    }
    await app.close();
    process.exit(0);
  }
  let created = 0;
  let updated = 0;
  for (const e of entries) {
    const input = {
      statement: e.statement,
      body: e.body,
      situations: e.situations ?? [],
      exampleQueries: e.exampleQueries ?? [],
      keywords: [],
      topics: [],
      facets: e.facets ?? {},
      attributes: { detail: e.detail, clinical: !!e.clinical },
      isGlobal: !e.tenantIds?.length,
      tenantIds: e.tenantIds ?? [],
      pinned: true,
    };
    const code = existing.get(e.statement);
    if (!apply) {
      console.log(`${code ? 'update ' + code : 'create'}  ${e.key}`);
      continue;
    }
    const chunk = code
      ? await chunks.updateAuthored(code, input, actor)
      : await chunks.createAuthored('debrief_guidance', input, actor);
    code ? updated++ : created++;
    console.log(`${code ? 'updated' : 'created'} ${chunk.code}  ${e.key}`);
  }
  console.log(
    apply
      ? `done: ${created} created, ${updated} updated`
      : 'dry run: nothing written (add --apply)',
  );
  await app.close();
  process.exit(0);
})().catch((err) => {
  const findings = err?.response?.findings ?? err?.getResponse?.()?.findings;
  console.error(
    'failed:',
    err.message,
    findings ? JSON.stringify(findings) : '',
  );
  process.exit(1);
});
