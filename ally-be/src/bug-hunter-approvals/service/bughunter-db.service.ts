import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Bug Hunter v2's data lives in ally-be's own database, in the `bughunter` schema
 * (bug-hunter/db/ally-db-setup.sql), so it is read with ally-be's normal connection,
 * like the old Bug Hunter. The agent writes there with its own role, which has no
 * grant on ally-be's tables; ally-be reads it through the `bughunter_dashboard` group
 * role (bug-hunter/migrations/0007_dashboard_role_grants.sql).
 *
 * No entities are registered (raw, parameterised SQL against `bughunter.*`), so ally-be's
 * entity glob and migration generator never see these tables: the schema is owned by
 * `bug-hunter/migrations/`, never by ally-be. Until the schema exists in an environment
 * the endpoints answer 503 instead of failing on a missing table.
 */
@Injectable()
export class BughunterDbService {
  private ready = false;

  constructor(private readonly dataSource: DataSource) {}

  async get(): Promise<DataSource> {
    if (this.ready) return this.dataSource;
    const [row] = await this.dataSource.query(
      `SELECT to_regclass('bughunter.reports') IS NOT NULL AS present`,
    );
    if (!row?.present) {
      throw new ServiceUnavailableException(
        'Bug Hunter v2 is not set up in this environment’s database.',
      );
    }
    this.ready = true;
    return this.dataSource;
  }
}
