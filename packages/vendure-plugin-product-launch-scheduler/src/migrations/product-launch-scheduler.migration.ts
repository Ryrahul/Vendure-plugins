import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';

import { ProductLaunchScheduleExecution } from '../entities/product-launch-schedule-execution.entity';
import { ProductLaunchSchedule } from '../entities/product-launch-schedule.entity';

/**
 * Creates the `product_launch_schedule` and `product_launch_schedule_execution` tables.
 *
 * Opt-in: add it to `dbConnectionOptions.migrations` **or** generate your own with
 * `npx vendure migrate`, not both.
 *
 * The tables are built from the entities' TypeORM metadata (what `synchronize` uses), so the
 * migration works on Postgres, MySQL/MariaDB and SQLite and follows the configured
 * EntityIdStrategy and `entityPrefix`.
 *
 * @example
 * ```ts
 * import { ProductLaunchSchedulerMigration1792800000000 } from '@rahul_vendure/vendure-plugin-product-launch-scheduler';
 *
 * dbConnectionOptions: {
 *     migrations: [ProductLaunchSchedulerMigration1792800000000, path.join(__dirname, 'migrations/*.+(js|ts)')],
 * }
 * ```
 */
export class ProductLaunchSchedulerMigration1792800000000 implements MigrationInterface {
    name = 'ProductLaunchSchedulerMigration1792800000000';

    async up(queryRunner: QueryRunner): Promise<void> {
        // The schedule table first: executions reference it.
        for (const entity of [ProductLaunchSchedule, ProductLaunchScheduleExecution]) {
            const metadata = queryRunner.connection.getMetadata(entity);
            if (await queryRunner.hasTable(metadata.tablePath)) {
                continue;
            }
            const driver = queryRunner.connection.driver;
            const table = Table.create(metadata, driver);
            await queryRunner.createTable(table, false, false, true);
            await queryRunner.createForeignKeys(
                table,
                metadata.foreignKeys.map(fk => TableForeignKey.create(fk, driver)),
            );
        }
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        for (const entity of [ProductLaunchScheduleExecution, ProductLaunchSchedule]) {
            const metadata = queryRunner.connection.getMetadata(entity);
            if (await queryRunner.hasTable(metadata.tablePath)) {
                await queryRunner.dropTable(metadata.tablePath, true, true, true);
            }
        }
    }
}
