import { DeepPartial, EntityId, ID, Product, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import {
    ProductLaunchAction,
    ProductLaunchEndAction,
    ProductLaunchScheduleStatus,
    ProductLaunchStep,
} from '../services/schedule-rules';

/**
 * A scheduled change of a product's global `enabled` state: a start step at `scheduledAt` and,
 * optionally, an end step at `endAt`.
 *
 * All times are UTC instants. `timezone` and the `local*` fields record what the administrator
 * entered, for display.
 */
@Entity()
@Index(['status', 'nextRunAt'])
@Index(['productId', 'status'])
export class ProductLaunchSchedule extends VendureEntity {
    constructor(input?: DeepPartial<ProductLaunchSchedule>) {
        super(input);
    }

    @ManyToOne(() => Product, { onDelete: 'CASCADE', nullable: false })
    product: Product;

    @EntityId()
    productId: ID;

    @Column({ type: 'varchar', nullable: true })
    name: string | null;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ type: 'varchar', length: 16 })
    action: ProductLaunchAction;

    @Column({ type: Date })
    scheduledAt: Date;

    @Column({ type: Date, nullable: true })
    endAt: Date | null;

    @Column({ type: 'varchar', length: 16, nullable: true })
    endAction: ProductLaunchEndAction | null;

    @Column({ type: 'varchar', length: 64 })
    timezone: string;

    @Column({ type: 'varchar', length: 16 })
    localScheduledAt: string;

    @Column({ type: 'varchar', length: 16, nullable: true })
    localEndAt: string | null;

    @Column({ type: 'varchar', length: 16 })
    status: ProductLaunchScheduleStatus;

    @Column({ type: 'varchar', length: 16, nullable: true })
    nextStep: ProductLaunchStep | null;

    @Column({ type: Date, nullable: true })
    nextRunAt: Date | null;

    /** Attempts of the current step. */
    @Column({ type: 'int', default: 0 })
    attempts: number;

    /** Incremented on every claim, so that only one worker can claim a due schedule. */
    @Column({ type: 'int', default: 0 })
    revision: number;

    @Column({ type: Date, nullable: true })
    leaseExpiresAt: Date | null;

    @Column({ type: 'boolean', nullable: true })
    startEnabledBefore: boolean | null;

    @Column({ type: 'boolean', nullable: true })
    startEnabledAfter: boolean | null;

    @Column({ type: Date, nullable: true })
    lastExecutedAt: Date | null;

    @Column({ type: 'text', nullable: true })
    lastError: string | null;

    @EntityId({ nullable: true })
    createdByUserId: ID | null;
}
