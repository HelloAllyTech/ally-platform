/**
 * `npm run migration:run`: run pending migrations under the shared migration lock.
 *
 * Replaces the plain TypeORM CLI command, which takes no lock and so raced the app's own run
 * on boot during a deploy (see src/database/migration-runner.ts). The deploy job and local
 * development call it exactly as before.
 */
import { dataSourceOptions } from '../data-source';
import { runMigrationsExclusively } from '../migration-runner';

runMigrationsExclusively(dataSourceOptions)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error during migration run:', error);
    process.exit(1);
  });
