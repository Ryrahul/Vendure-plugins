import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

import { ProductChannelAvailability } from '../entities/product-channel-availability.entity';

/**
 * Creates the `product_channel_availability` table.
 *
 * Opt-in: add it to `dbConnectionOptions.migrations` **or** generate your own with
 * `npx vendure migrate` — not both.
 *
 * The table is built from the entity's TypeORM metadata (the same mechanism
 * `synchronize` uses), so it is database-agnostic (Postgres, MySQL/MariaDB, SQLite)
 * and follows the configured EntityIdStrategy (integer or UUID ids) and
 * `entityPrefix`. No data is back-filled: products without a row inherit
 * `Product.enabled`.
 *
 * @example
 * ```ts
 * import { ChannelProductAvailabilityMigration1792195200000 } from '@rahul_vendure/vendure-plugin-channel-product-availability';
 *
 * dbConnectionOptions: {
 *     migrations: [ChannelProductAvailabilityMigration1792195200000, path.join(__dirname, 'migrations/*.+(js|ts)')],
 * }
 * ```
 */
export class ChannelProductAvailabilityMigration1792195200000 implements MigrationInterface {
    name = 'ChannelProductAvailabilityMigration1792195200000';

    async up(queryRunner: QueryRunner): Promise<void> {
        const metadata = queryRunner.connection.getMetadata(ProductChannelAvailability);
        if (await queryRunner.hasTable(metadata.tablePath)) {
            return;
        }
        const driver = queryRunner.connection.driver;
        const table = Table.create(metadata, driver);
        // indices and uniques are part of the Table definition; foreign keys are added explicitly.
        await queryRunner.createTable(table, false, false, true);
        await queryRunner.createForeignKeys(
            table,
            metadata.foreignKeys.map(fk => TableForeignKey.create(fk, driver)),
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        const metadata = queryRunner.connection.getMetadata(ProductChannelAvailability);
        if (await queryRunner.hasTable(metadata.tablePath)) {
            await queryRunner.dropTable(metadata.tablePath, true, true, true);
        }
    }
}
