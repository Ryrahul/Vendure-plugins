import { OnApplicationBootstrap } from '@nestjs/common';
import {
    ChannelEvent,
    EventBus,
    ID,
    Logger,
    PluginCommonModule,
    ProcessContext,
    ProductChannelEvent,
    ProductEvent,
    RequestContext,
    Type,
    VendurePlugin,
} from '@vendure/core';

import { ChannelProductAvailabilityAdminResolver } from './api/admin.resolver';
import { adminApiExtensions } from './api/api-extensions';
import { AdminDraftOrderAvailabilityResolver, ShopOrderAvailabilityResolver } from './api/order.resolver';
import { ShopCatalogAvailabilityResolver, ShopCollectionAvailabilityResolver } from './api/shop-catalog.resolver';
import { CHANNEL_PRODUCT_AVAILABILITY_OPTIONS, loggerCtx } from './constants';
import { ProductChannelAvailability } from './entities/product-channel-availability.entity';
import { ProductChannelAvailabilityEvent } from './events/product-channel-availability.event';
import { ChannelAvailabilityOrderInterceptor } from './order/channel-availability-order-interceptor';
import { createChannelAvailabilityOrderProcess } from './order/channel-availability-order-process';
import { OverridePurchaseService } from './order/override-purchase.service';
import { SearchIndexSyncService } from './search/search-index-sync.service';
import { ChannelAccessService } from './services/channel-access.service';
import { ChannelProductAvailabilityService } from './services/channel-product-availability.service';
import {
    ChannelProductAvailabilityPluginOptions,
    defaultOptions,
    ResolvedChannelProductAvailabilityOptions,
} from './types';

/**
 * Per-channel overrides of `Product.enabled`, enforced across Shop API catalog
 * queries, the DefaultSearchPlugin index, add-to-cart and checkout.
 *
 * @example
 * ```ts
 * plugins: [ChannelProductAvailabilityPlugin.init({})]
 * ```
 *
 * Adds the `product_channel_availability` table — run a migration (see README).
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [ProductChannelAvailability],
    providers: [
        { provide: CHANNEL_PRODUCT_AVAILABILITY_OPTIONS, useFactory: () => ChannelProductAvailabilityPlugin.options },
        ChannelProductAvailabilityService,
        ChannelAccessService,
        SearchIndexSyncService,
        OverridePurchaseService,
    ],
    exports: [ChannelProductAvailabilityService],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: () => [
            ChannelProductAvailabilityAdminResolver,
            ...(ChannelProductAvailabilityPlugin.options.enableOverridePurchasing
                ? [AdminDraftOrderAvailabilityResolver]
                : []),
        ],
    },
    shopApiExtensions: {
        resolvers: () => [
            ...(ChannelProductAvailabilityPlugin.options.enforceCatalog
                ? [ShopCatalogAvailabilityResolver, ShopCollectionAvailabilityResolver]
                : []),
            ...(ChannelProductAvailabilityPlugin.options.enableOverridePurchasing
                ? [ShopOrderAvailabilityResolver]
                : []),
        ],
    },
    configuration: config => {
        const options = ChannelProductAvailabilityPlugin.options;
        config.orderOptions.orderInterceptors = [
            ...(config.orderOptions.orderInterceptors ?? []),
            new ChannelAvailabilityOrderInterceptor(),
        ];
        if (options.validateOnCheckout) {
            config.orderOptions.process = [
                ...(config.orderOptions.process ?? []),
                createChannelAvailabilityOrderProcess(),
            ];
        }
        return config;
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.6.0',
})
export class ChannelProductAvailabilityPlugin implements OnApplicationBootstrap {
    static options: ResolvedChannelProductAvailabilityOptions = defaultOptions;

    static init(options: ChannelProductAvailabilityPluginOptions = {}): Type<ChannelProductAvailabilityPlugin> {
        this.options = { ...defaultOptions, ...options };
        return ChannelProductAvailabilityPlugin;
    }

    constructor(
        private eventBus: EventBus,
        private availabilityService: ChannelProductAvailabilityService,
        private processContext: ProcessContext,
    ) {}

    onApplicationBootstrap() {
        if (!this.processContext.isServer) {
            return;
        }
        this.eventBus.ofType(ProductEvent).subscribe(event => {
            if (event.type === 'deleted') {
                void this.safely(() => this.availabilityService.removeOverrides(event.ctx, { productId: event.entity.id }));
            } else if (event.type === 'updated' && (event.input as any)?.enabled !== undefined) {
                void this.publishGlobalChange(event.ctx, event.entity.id);
            }
        });
        this.eventBus.ofType(ProductChannelEvent).subscribe(event => {
            if (event.type === 'removed') {
                void this.safely(() =>
                    this.availabilityService.removeOverrides(event.ctx, {
                        productId: event.product.id,
                        channelId: event.channelId,
                    }),
                );
            }
        });
        this.eventBus.ofType(ChannelEvent).subscribe(event => {
            if (event.type === 'deleted') {
                void this.safely(() => this.availabilityService.removeOverrides(event.ctx, { channelId: event.entity.id }));
            }
        });
    }

    private async publishGlobalChange(ctx: RequestContext, productId: ID) {
        await this.eventBus.publish(
            new ProductChannelAvailabilityEvent(ctx, 'global-changed', productId, null, null, null),
        );
    }

    private async safely(fn: () => Promise<unknown>) {
        try {
            await fn();
        } catch (e: any) {
            Logger.error(`Failed to clean up channel availability overrides: ${e?.message}`, loggerCtx, e?.stack);
        }
    }
}
