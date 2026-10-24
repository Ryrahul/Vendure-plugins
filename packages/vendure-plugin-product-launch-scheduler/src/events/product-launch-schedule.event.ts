import { RequestContext, VendureEvent } from '@vendure/core';

import { ProductLaunchSchedule } from '../entities/product-launch-schedule.entity';
import { ProductLaunchExecutionOutcome, ProductLaunchStep } from '../services/schedule-rules';

export type ProductLaunchScheduleEventType = 'created' | 'updated' | 'cancelled' | 'retried' | 'executed' | 'failed';

/**
 * Published when a schedule is created, changed, cancelled or retried, and when a step runs
 * (`executed`) or fails permanently (`failed`). Delivered after the transaction commits.
 *
 * @example
 * ```ts
 * eventBus.ofType(ProductLaunchScheduleEvent).subscribe(event => {
 *     if (event.type === 'failed') notifyTeam(event.schedule);
 * });
 * ```
 */
export class ProductLaunchScheduleEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public schedule: ProductLaunchSchedule,
        public type: ProductLaunchScheduleEventType,
        /** For `executed` and `failed`: the step that ran. */
        public step?: ProductLaunchStep,
        /** For `executed` and `failed`: what happened. */
        public outcome?: ProductLaunchExecutionOutcome,
    ) {
        super();
    }
}
