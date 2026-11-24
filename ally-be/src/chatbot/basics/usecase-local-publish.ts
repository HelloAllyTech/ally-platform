/**
 * Test only, local only (chunk Q4, the use-case suite): publish a draft whose publish the checkup
 * gate held, so the suite can still measure its replies at the baseline.
 *
 *   npm run usecases:local-publish -- --draft <draft id> [--access public|invite] [--emails a,b]
 *
 * It calls the same `BotDraftPublishService.publish` the route calls after its gate, so the
 * assistant, page and access list are exactly what a real publish writes. It never touches the
 * route, the gate or `safety_recheck`: an owner can only publish through the route. It refuses to
 * run unless NODE_ENV is development or local, before the app starts. The setup script records
 * every assistant published this way as "held by the gate, published locally for measuring".
 */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
loadEnv();

import { NestFactory } from '@nestjs/core';
import { BotDraftPublishService } from '../../bot-draft/service/bot-draft-publish.service';
import { DataSource } from 'typeorm';
import { BotDraftEntity } from '../../bot-draft/entity/bot-draft.entity';
import { ExecutionManager } from '../../common/execution/execution-manager';

const LOCAL_ENVS = new Set(['development', 'local']);

/** Whether this process may publish past the gate: only on a development or local stack. */
export function localPublishAllowed(nodeEnv: string | undefined): boolean {
  return LOCAL_ENVS.has(
    String(nodeEnv ?? '')
      .trim()
      .toLowerCase(),
  );
}

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : undefined;
}

async function main(): Promise<void> {
  if (!localPublishAllowed(process.env.NODE_ENV)) {
    console.error(
      `Refused: local publish is for development stacks only (NODE_ENV=${process.env.NODE_ENV ?? 'unset'}).`,
    );
    process.exit(2);
  }
  const draftId = arg('draft');
  if (!draftId) {
    console.error(
      'Usage: --draft <draft id> [--access public|invite] [--emails a,b]',
    );
    process.exit(2);
  }
  const access = (arg('access') ?? 'public') as 'public' | 'invite';
  const emails = (arg('emails') ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  // Loaded here, not at the top: importing AppModule validates the environment, which a unit
  // test of `localPublishAllowed` (no .env in CI) must not do.
  const { AppModule } = await import('../../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const publisher = app.get(BotDraftPublishService, { strict: false });
    // As the draft's owner: the publish reads the owner and tenant from the execution context.
    const draft = await app
      .get(DataSource)
      .getRepository(BotDraftEntity)
      .findOne({ where: { id: draftId } });
    if (!draft) throw new Error('That setup was not found.');
    const result = await ExecutionManager.runWithContext(
      async () => {
        ExecutionManager.setAuthContext(
          String(draft.ownerUserId),
          String(draft.tenantId ?? ''),
        );
        return publisher.publish(draft, {
          access,
          ...(emails.length ? { emails } : {}),
        });
      },
      { path: 'usecases:local-publish' },
    );
    console.log(JSON.stringify({ localPublish: true, ...result }));
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  // The app context's pollers can keep the process alive after `close`: exit once done.
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
