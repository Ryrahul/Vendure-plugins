import { OnApplicationBootstrap } from '@nestjs/common';
import {
    ConfigService,
    EventBus,
    Logger,
    PluginCommonModule,
    ProcessContext,
    ProductEvent,
    Type,
    VendurePlugin,
} from '@vendure/core';

import { ProductLaunchScheduleAdminResolver, ProductLaunchScheduleEntityResolver } from './api/admin.resolver';
import { adminApiExtensions } from './api/api-extensions';
import { loggerCtx, PRODUCT_LAUNCH_SCHEDULER_OPTIONS } from './constants';
import { ProductLaunchScheduleExecution } from './entities/product-launch-schedule-execution.entity';
import { ProductLaunchSchedule } from './entities/product-launch-schedule.entity';
import { createProcessDueTask } from './scheduled-task';
import { ProductLaunchExecutorService } from './services/product-launch-executor.service';
import { ProductLaunchScheduleService } from './services/product-launch-schedule.service';
import { defaultOptions, ProductLaunchSchedulerOptions, ResolvedProductLaunchSchedulerOptions } from './types';

/**
 * Schedules products to be enabled or disabled at a future time.
 *
 * A schedule changes the product's global `enabled` flag, so it affects every channel.
 * Requires a scheduler strategy (e.g. `DefaultSchedulerPlugin`); due steps run on the worker.
 *
 * @example
 * ```ts
 * plugins: [DefaultSchedulerPlugin.init(), ProductLaunchSchedulerPlugin.init({})]
 * ```
 *
 * Adds two tables: run a migration (see README).
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [ProductLaunchSchedule, ProductLaunchScheduleExecution],
    providers: [
        { provide: PRODUCT_LAUNCH_SCHEDULER_OPTIONS, useFactory: () => ProductLaunchSchedulerPlugin.options },
        ProductLaunchScheduleService,
        ProductLaunchExecutorService,
    ],
    exports: [ProductLaunchScheduleService, ProductLaunchExecutorService],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [ProductLaunchScheduleAdminResolver, ProductLaunchScheduleEntityResolver],
    },
    configuration: config => {
        config.schedulerOptions.tasks = [
            ...(config.schedulerOptions.tasks ?? []),
            createProcessDueTask(ProductLaunchSchedulerPlugin.options),
        ];
        return config;
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.6.0',
})
export class ProductLaunchSchedulerPlugin implements OnApplicationBootstrap {
    static options: ResolvedProductLaunchSchedulerOptions = defaultOptions;

    static init(options: ProductLaunchSchedulerOptions = {}): Type<ProductLaunchSchedulerPlugin> {
        this.options = { ...defaultOptions, ...options };
        return ProductLaunchSchedulerPlugin;
    }

    constructor(
        private eventBus: EventBus,
        private scheduleService: ProductLaunchScheduleService,
        private processContext: ProcessContext,
        private configService: ConfigService,
    ) {}

    onApplicationBootstrap() {
        if (this.configService.schedulerOptions.schedulerStrategy?.constructor?.name === 'NoopSchedulerStrategy') {
            Logger.error(
                'No scheduler strategy is configured, so product launch schedules will never run. ' +
                    'Add DefaultSchedulerPlugin.init() (or another scheduler) to your plugins.',
                loggerCtx,
            );
        }
        if (!this.processContext.isServer) {
            return;
        }
        // Soft-deleting a product cancels its unfinished schedules.
        this.eventBus.ofType(ProductEvent).subscribe(event => {
            if (event.type !== 'deleted') {
                return;
            }
            this.scheduleService.cancelForDeletedProduct(event.ctx, event.entity.id).catch((e: any) =>
                Logger.error(`Could not cancel schedules of deleted product ${String(event.entity.id)}: ${e?.message}`, loggerCtx),
            );
        });
    }
}
