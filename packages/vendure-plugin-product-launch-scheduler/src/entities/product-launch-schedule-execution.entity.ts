import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { ProductLaunchExecutionOutcome, ProductLaunchStep } from '../services/schedule-rules';

import { ProductLaunchSchedule } from './product-launch-schedule.entity';

/** One attempt to run a step of a schedule (append-only history). */
@Entity()
@Index(['scheduleId', 'executedAt'])
export class ProductLaunchScheduleExecution extends VendureEntity {
    constructor(input?: DeepPartial<ProductLaunchScheduleExecution>) {
        super(input);
    }

    @ManyToOne(() => ProductLaunchSchedule, { onDelete: 'CASCADE', nullable: false })
    schedule: ProductLaunchSchedule;

    @EntityId()
    scheduleId: ID;

    @Column({ type: 'varchar', length: 16 })
    step: ProductLaunchStep;

    /** The action of the step: `ENABLE`, `DISABLE` or `RESTORE`. */
    @Column({ type: 'varchar', length: 16 })
    action: string;

    @Column({ type: 'varchar', length: 16 })
    outcome: ProductLaunchExecutionOutcome;

    @Column({ type: 'boolean', nullable: true })
    enabledBefore: boolean | null;

    @Column({ type: 'boolean', nullable: true })
    enabledAfter: boolean | null;

    @Column({ type: 'int' })
    attempt: number;

    @Column({ type: 'text', nullable: true })
    message: string | null;

    /** How long after its scheduled time the step ran. */
    @Column({ type: 'int', default: 0 })
    ranLateBySeconds: number;

    @Column({ type: Date })
    executedAt: Date;
}
