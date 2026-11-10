import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntitySubscriberInterface,
  InsertEvent,
  RecoverEvent,
  RemoveEvent,
  SoftRemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { CATALOGUE_KIND_BY_TABLE } from '../profiles/content-catalogue.profile';
import { ContextCatalogueSyncService } from './context-catalogue-sync.service';

/**
 * Hears every write to the four Studio tables the Content Catalogue mirrors — `scenarios`,
 * `cases`, `scenario_characters`, `track_component_templates` — and queues the row for
 * `ContextCatalogueSyncService` (PLAN.md §6.4: "kept in step by a subscriber on create, update,
 * archive and delete").
 *
 * A TypeORM subscriber rather than a call in each Studio service: roleplays alone are written
 * from a dozen places (create, edit, publish a version, archive, duplicate, soft delete, inside
 * transactions), and a hook on each would be one more thing every future write path has to
 * remember. This hears them all without any Studio service changing. A write that names no row
 * (a bulk `update` or `delete` by criteria) queues the whole kind; a raw SQL write is not heard
 * at all, and the nightly reconciliation heals it.
 *
 * Only queues. The sync runs after a short pause, outside the writer's transaction, so it can
 * never slow down or fail a Studio save.
 */
@Injectable()
export class ContextCatalogueSubscriber implements EntitySubscriberInterface {
  constructor(
    dataSource: DataSource,
    private readonly sync: ContextCatalogueSyncService,
  ) {
    if (Array.isArray(dataSource?.subscribers)) {
      dataSource.subscribers.push(this);
    }
  }

  private note(
    table: string | undefined,
    entity: unknown,
    entityId?: unknown,
  ): void {
    const kind = table ? CATALOGUE_KIND_BY_TABLE[table] : undefined;
    if (!kind) return;
    const id =
      (entity as { id?: unknown } | undefined)?.id ??
      (typeof entityId === 'string' || typeof entityId === 'number'
        ? entityId
        : (entityId as { id?: unknown } | undefined)?.id);
    if (typeof id === 'string' || typeof id === 'number') {
      this.sync.queueItem(kind, id);
    } else {
      this.sync.queueKind(kind);
    }
  }

  afterInsert(event: InsertEvent<unknown>): void {
    this.note(event.metadata?.tableName, event.entity);
  }

  afterUpdate(event: UpdateEvent<unknown>): void {
    this.note(
      event.metadata?.tableName,
      event.entity ?? event.databaseEntity ?? undefined,
    );
  }

  afterRemove(event: RemoveEvent<unknown>): void {
    this.note(
      event.metadata?.tableName,
      event.databaseEntity ?? event.entity ?? undefined,
      event.entityId,
    );
  }

  afterSoftRemove(event: SoftRemoveEvent<unknown>): void {
    this.note(
      event.metadata?.tableName,
      event.databaseEntity ?? event.entity ?? undefined,
      event.entityId,
    );
  }

  afterRecover(event: RecoverEvent<unknown>): void {
    this.note(
      event.metadata?.tableName,
      event.databaseEntity ?? event.entity ?? undefined,
      event.entityId,
    );
  }
}
