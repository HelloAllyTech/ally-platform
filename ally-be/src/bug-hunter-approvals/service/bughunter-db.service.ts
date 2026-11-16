import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * The second TypeORM data source: Bug Hunter v2's own `bughunter` database, reached
 * with the limited `bughunter_dashboard` role (read reports, write verdicts). It is
 * created lazily on first use, so ally-be boots as before when the BUGHUNTER_DB_*
 * variables are not set; the endpoints then answer 503.
 *
 * No entities are registered (raw, parameterised SQL), so nothing here is picked up
 * by ally-be's own entity glob or migration generator: the bughunter schema is owned
 * by `bug-hunter/migrations/`, never by ally-be.
 */
@Injectable()
export class BughunterDbService implements OnModuleDestroy {
  private readonly logger = new Logger(BughunterDbService.name);
  private dataSource: DataSource | null = null;
  private connecting: Promise<DataSource> | null = null;

  static configured(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env.BUGHUNTER_DB_HOST && env.BUGHUNTER_DB_DATABASE);
  }

  async get(): Promise<DataSource> {
    if (this.dataSource?.isInitialized) return this.dataSource;
    if (!BughunterDbService.configured()) {
      throw new ServiceUnavailableException(
        'The Bug Hunter database is not configured for this environment.',
      );
    }
    if (!this.connecting) {
      const ds = new DataSource({
        type: 'postgres',
        host: process.env.BUGHUNTER_DB_HOST,
        port: Number(process.env.BUGHUNTER_DB_PORT || 5432),
        username: process.env.BUGHUNTER_DB_USERNAME,
        password: process.env.BUGHUNTER_DB_PASSWORD,
        database: process.env.BUGHUNTER_DB_DATABASE,
        entities: [],
        synchronize: false,
        migrationsRun: false,
        extra: { max: 3 },
      });
      this.connecting = ds.initialize().then(
        (ready) => (this.dataSource = ready),
        (error) => {
          this.connecting = null;
          this.logger.error('Could not reach the Bug Hunter database', error);
          throw new ServiceUnavailableException(
            'The Bug Hunter database is unreachable.',
          );
        },
      );
    }
    return this.connecting;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource?.isInitialized) await this.dataSource.destroy();
  }
}
