import { Inject } from '@nestjs/common';
import { Args, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Allow, ConfigService, Ctx, Permission, ProductService, RequestContext, Transaction } from '@vendure/core';

import { PROCESS_DUE_TASK_ID, PRODUCT_LAUNCH_SCHEDULER_OPTIONS } from '../constants';
import { ProductLaunchSchedule } from '../entities/product-launch-schedule.entity';
import {
    MutationCancelProductLaunchScheduleArgs,
    MutationCreateProductLaunchScheduleArgs,
    MutationRetryProductLaunchScheduleArgs,
    MutationUpdateProductLaunchScheduleArgs,
    QueryProductLaunchScheduleArgs,
    QueryProductLaunchScheduleExecutionsArgs,
    QueryProductLaunchSchedulesArgs,
    QueryProductLaunchTimePreviewArgs,
} from '../generated-graphql-types';
import { ProductLaunchScheduleService } from '../services/product-launch-schedule.service';
import { ResolvedProductLaunchSchedulerOptions } from '../types';

const READ = [Permission.ReadCatalog, Permission.ReadProduct];
const UPDATE = [Permission.UpdateCatalog, Permission.UpdateProduct];

@Resolver()
export class ProductLaunchScheduleAdminResolver {
    constructor(
        private scheduleService: ProductLaunchScheduleService,
        private configService: ConfigService,
        @Inject(PRODUCT_LAUNCH_SCHEDULER_OPTIONS) private options: ResolvedProductLaunchSchedulerOptions,
    ) {}

    @Query()
    @Allow(...READ)
    productLaunchSchedules(@Ctx() ctx: RequestContext, @Args() args: QueryProductLaunchSchedulesArgs) {
        return this.scheduleService.findAll(ctx, args.options ?? {});
    }

    @Query()
    @Allow(...READ)
    productLaunchSchedule(@Ctx() ctx: RequestContext, @Args() args: QueryProductLaunchScheduleArgs) {
        return this.scheduleService.findOne(ctx, args.id);
    }

    @Query()
    @Allow(...READ)
    productLaunchScheduleExecutions(@Ctx() ctx: RequestContext, @Args() args: QueryProductLaunchScheduleExecutionsArgs) {
        return this.scheduleService.findExecutions(ctx, args.scheduleId, args.options ?? {});
    }

    @Query()
    @Allow(...READ)
    productLaunchSchedulerStatus() {
        const { schedulerStrategy, tasks } = this.configService.schedulerOptions;
        const options = this.options;
        return {
            schedulerRunning:
                !!schedulerStrategy &&
                schedulerStrategy.constructor?.name !== 'NoopSchedulerStrategy' &&
                (tasks ?? []).some(task => task.id === PROCESS_DUE_TASK_ID),
            pollSchedule: options.pollSchedule,
            maxAttempts: options.maxAttempts,
        };
    }

    @Query()
    @Allow(...READ)
    productLaunchTimePreview(@Args() args: QueryProductLaunchTimePreviewArgs) {
        return this.scheduleService.previewTime(args.localTime, args.timezone);
    }

    @Transaction()
    @Mutation()
    @Allow(...UPDATE)
    createProductLaunchSchedule(@Ctx() ctx: RequestContext, @Args() args: MutationCreateProductLaunchScheduleArgs) {
        return this.scheduleService.create(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(...UPDATE)
    updateProductLaunchSchedule(@Ctx() ctx: RequestContext, @Args() args: MutationUpdateProductLaunchScheduleArgs) {
        return this.scheduleService.update(ctx, args.input);
    }

    @Transaction()
    @Mutation()
    @Allow(...UPDATE)
    cancelProductLaunchSchedule(@Ctx() ctx: RequestContext, @Args() args: MutationCancelProductLaunchScheduleArgs) {
        return this.scheduleService.cancel(ctx, args.id);
    }

    @Transaction()
    @Mutation()
    @Allow(...UPDATE)
    retryProductLaunchSchedule(@Ctx() ctx: RequestContext, @Args() args: MutationRetryProductLaunchScheduleArgs) {
        return this.scheduleService.retry(ctx, args.id);
    }
}

@Resolver('ProductLaunchSchedule')
export class ProductLaunchScheduleEntityResolver {
    constructor(private productService: ProductService) {}

    @ResolveField()
    product(@Ctx() ctx: RequestContext, @Parent() schedule: ProductLaunchSchedule) {
        return this.productService.findOne(ctx, schedule.productId);
    }
}
