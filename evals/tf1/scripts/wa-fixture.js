// TF1 round 2: give a local assistant its own (fake) WhatsApp number, so the signed per-number
// webhook (/api/v1/webhook/whatsapp/<webhookKey>) reaches it. Test data only, ally_local only.
// Meta's check is skipped (offline); sends fail at Meta with the fake token, the replies are still
// written to wa_messages, which wa.mjs reads back.
//   docker cp evals/tf1/scripts/wa-fixture.js ally-be-app-1:/tmp/wa-fixture.js
//   docker exec -w /app -e WA_SECRET=... ally-be-app-1 node /tmp/wa-fixture.js --chatbot <id> --pnid <digits>
const { randomBytes } = require('crypto');
const { NestFactory } = require('/app/node_modules/@nestjs/core');
const { DataSource } = require('/app/node_modules/typeorm');
const { AppModule } = require('/app/dist/app.module');
const { Connector } = require('/app/dist/chatbot/entity/connector.entity');
const { WaBusinessNumber } = require('/app/dist/whatsapp/entity/wa-business-number.entity');
const { WhatsAppCredentialCipherService } = require('/app/dist/whatsapp/service/whatsapp-credential-cipher.service');
const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
(async () => {
  if (process.env.DB_DATABASE !== 'ally_local') throw new Error('refusing: database is ' + process.env.DB_DATABASE);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const ds = app.get(DataSource);
  const cipher = app.get(WhatsAppCredentialCipherService, { strict: false });
  const chatbotId = arg('chatbot'); const pnid = arg('pnid');
  const existing = await ds.getRepository(WaBusinessNumber).findOne({ where: { phoneNumberId: pnid } });
  if (existing) { console.log('exists', existing.webhookKey); process.exit(0); }
  const conn = await ds.getRepository(Connector).save(ds.getRepository(Connector).create({ type: 'whatsapp', name: 'WhatsApp TF1 R2 ' + pnid, chatbotId, status: 'connected', createdBy: 25, updatedBy: 25 }));
  const row = await ds.getRepository(WaBusinessNumber).save(ds.getRepository(WaBusinessNumber).create({
    tenantId: null, connectorId: conn.id, phoneNumberId: pnid, wabaId: 'TF1-WABA-' + pnid, displayPhoneNumber: '+1 555 000 ' + pnid.slice(-4), verifiedName: 'TF1 R2',
    accessTokenEnc: await cipher.encrypt('tf1-fake-token'), appSecretEnc: await cipher.encrypt(process.env.WA_SECRET),
    webhookKey: randomBytes(24).toString('base64url'), verifyToken: randomBytes(24).toString('hex'),
    source: 'manual', status: 'connected', lastCheckedAt: new Date(), lastError: null, createdBy: 25, updatedBy: 25 }));
  console.log('webhookKey', row.webhookKey, 'connector', conn.id);
  await app.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
