import { Collection } from '../entity/collection.entity';
import { CollectionConstraint } from '../entity/collection-constraint.entity';
import { CollectionField } from '../entity/collection-field.entity';
import { CollectionRecord } from '../entity/collection-record.entity';
import { RecordEvent } from '../entity/record-event.entity';
import { RecordLink } from '../entity/record-link.entity';

/** The lists' entities, for a DataSource built outside the app (the seed script, Postgres specs). */
export const LIST_ENTITIES = [
  Collection,
  CollectionField,
  CollectionConstraint,
  CollectionRecord,
  RecordLink,
  RecordEvent,
];
