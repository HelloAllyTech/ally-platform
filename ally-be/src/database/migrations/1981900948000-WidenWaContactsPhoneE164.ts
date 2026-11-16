import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Erasure writes `erased:<contact id>` over a number (43 characters), which did not fit
 * `wa_contacts.phone_e164` (varchar 32): on real Postgres an admin's erase returned 500 after the
 * messages were blanked, and the retention sweep stopped at the first stale contact, so numbers
 * past retention were never erased (CHUNK-12-NOTES.md §7). Widening keeps the full id in the
 * marker, so erased rows stay unique under the existing indexes, which are kept as they are.
 *
 * `wa_phone_mappings.phone_e164` is varchar(32) too, but nothing writes the marker there.
 *
 * Down narrows the column back, so it fails while an erased contact exists; that row would not
 * fit the old column.
 */
export class WidenWaContactsPhoneE1641981900948000 implements MigrationInterface {
  name = 'WidenWaContactsPhoneE1641981900948000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wa_contacts" ALTER COLUMN "phone_e164" TYPE varchar(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wa_contacts" ALTER COLUMN "phone_e164" TYPE varchar(32)`,
    );
  }
}
