// TF1 round 2: local credits top-up (ally_local only).
//   docker cp evals/tf1/scripts/topup.js ally-be-app-1:/tmp/topup.js
//   docker exec -w /app ally-be-app-1 node /tmp/topup.js --user 25 [--chatbot <id>] [--usd 10]
const { NestFactory } = require('/app/node_modules/@nestjs/core');
const { AppModule } = require('/app/dist/app.module');
const { LedgerService } = require('/app/dist/billing/service/ledger.service');
const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
(async () => {
  if (process.env.DB_DATABASE !== 'ally_local') throw new Error('refusing: database is ' + process.env.DB_DATABASE);
  const usd = Number(arg('usd') ?? 10);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const ledger = app.get(LedgerService, { strict: false });
  const g = await ledger.grant({ userId: Number(arg('user')), amountUsd: usd, kind: 'grant', note: 'TF1 round 2 final run', idempotencyKey: 'tf1-r2-' + Date.now() + '-' + Math.random() }, null);
  console.log('grant', JSON.stringify(g));
  if (arg('chatbot')) console.log('budget', JSON.stringify(await ledger.topUpBudget(arg('chatbot'), usd, null)));
  await app.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
