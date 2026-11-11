import { Logger, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';
import { AppConfigService } from '../config/config.service';
import { dataSourceOptions } from './data-source';
import {
  migrationsOnBootEnabled,
  runMigrationsExclusively,
} from './migration-runner';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: () => {
        const config = {
          ...dataSourceOptions,
          synchronize: false,
          // Migrations still run on boot, before the app serves anything, but through the
          // shared runner below: under one advisory lock and without the request pool's
          // statement timeout, so the deploy job's own `migration:run` waits for this one
          // instead of racing it.
          migrationsRun: false,
        };
        return config;
      },
      dataSourceFactory: async (options?: DataSourceOptions) => {
        if (!options) throw new Error('No database options');
        if (migrationsOnBootEnabled()) {
          await runMigrationsExclusively(options);
        } else {
          new Logger('DatabaseModule').log(
            'Skipping migrations on boot (DB_MIGRATIONS_ON_BOOT=false); the deploy runs them.',
          );
        }
        return new DataSource(options).initialize();
      },
    }),
  ],
})
export class DatabaseModule {}
