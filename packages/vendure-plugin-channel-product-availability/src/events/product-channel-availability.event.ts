import { ID, RequestContext, VendureEvent } from '@vendure/core';

import { OverrideState } from '../services/availability-rules';

/**
 * - `set`: an override was created or changed
 * - `cleared`: an override was removed by an admin/service call (inherits again)
 * - `removed`: an override was removed as a side effect (product deleted,
 *   product removed from channel, channel deleted)
 * - `global-changed`: `Product.enabled` changed; affects every channel without an
 *   override (`channelId` is `null`)
 */
export type ProductChannelAvailabilityEventType = 'set' | 'cleared' | 'removed' | 'global-changed';

/**
 * Published whenever the effective availability of a product in a channel may have
 * changed. Delivered after the surrounding transaction commits.
 *
 * Third-party search integrations should reindex `productId` in `channelId` (or in
 * all channels when `channelId` is `null`) when they receive this event.
 *
 * @example
 * ```ts
 * eventBus.ofType(ProductChannelAvailabilityEvent).subscribe(event => {
 *     mySearchIndex.reindexProduct(event.productId, event.channelId);
 * });
 * ```
 */
export class ProductChannelAvailabilityEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public type: ProductChannelAvailabilityEventType,
        public productId: ID,
        public channelId: ID | null,
        public previousState: OverrideState | null,
        public newState: OverrideState | null,
    ) {
        super();
    }
}
