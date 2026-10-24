import { Injectable } from '@nestjs/common';
import {
    ConfigService,
    EntityNotFoundError,
    EventBus,
    ID,
    Product,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { In } from 'typeorm';

import { ProductLaunchScheduleExecution } from '../entities/product-launch-schedule-execution.entity';
import { ProductLaunchSchedule } from '../entities/product-launch-schedule.entity';
import { ProductLaunchScheduleError } from '../errors';
import { ProductLaunchScheduleEvent } from '../events/product-launch-schedule.event';
import {
    CreateProductLaunchScheduleInput,
    ProductLaunchScheduleExecutionListOptions,
    ProductLaunchScheduleListOptions,
    ProductLaunchTimePreview,
    UpdateProductLaunchScheduleInput,
} from '../generated-graphql-types';
import { localTimeToInstant } from '../time/zoned-time';

import {
    canCancel,
    canRetry,
    editableFields,
    findConflict,
    PAST_GRACE_MS,
    ProductLaunchEndAction,
    ProductLaunchScheduleStatus,
    UNFINISHED_STATUSES,
    waitingStatusFor,
} from './schedule-rules';

const DEFAULT_TAKE = 20;
const MAX_TAKE = 100;

export interface ProductLaunchScheduleList {
    items: ProductLaunchSchedule[];
    totalItems: number;
}

/**
 * Creates, changes and lists product launch schedules. Running the steps is
 * {@link ProductLaunchExecutorService}'s job.
 *
 * Writes are conditional on the schedule's `revision`, so an administrator's change can never
 * overwrite a schedule a worker claimed in the meantime (and vice versa).
 */
@Injectable()
export class ProductLaunchScheduleService {
    constructor(
        private connection: TransactionalConnection,
        private eventBus: EventBus,
        private configService: ConfigService,
    ) {}

    /** Schedules of products in the active channel. */
    async findAll(ctx: RequestContext, options: ProductLaunchScheduleListOptions = {}): Promise<ProductLaunchScheduleList> {
        const qb = this.channelScopedQuery(ctx);
        if (options.productId) {
            qb.andWhere('schedule.productId = :productId', { productId: options.productId });
        }
        if (options.status?.length) {
            qb.andWhere('schedule.status IN (:...status)', { status: options.status });
        }
        if (options.from) {
            qb.andWhere('(schedule.scheduledAt >= :from OR schedule.endAt >= :from)', { from: options.from });
        }
        if (options.to) {
            qb.andWhere('schedule.scheduledAt <= :to', { to: options.to });
        }
        const sortBy = options.sortBy ?? 'scheduledAt';
        qb.orderBy(`schedule.${sortBy}`, options.sortOrder === 'DESC' ? 'DESC' : 'ASC').addOrderBy('schedule.id', 'ASC');
        qb.skip(Math.max(options.skip ?? 0, 0)).take(Math.min(Math.max(options.take ?? DEFAULT_TAKE, 1), MAX_TAKE));
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }

    /** A schedule of a product in the active channel, or undefined. */
    async findOne(ctx: RequestContext, id: ID): Promise<ProductLaunchSchedule | undefined> {
        const schedule = await this.channelScopedQuery(ctx).andWhere('schedule.id = :id', { id }).getOne();
        return schedule ?? undefined;
    }

    async findExecutions(
        ctx: RequestContext,
        scheduleId: ID,
        options: ProductLaunchScheduleExecutionListOptions = {},
    ): Promise<{ items: ProductLaunchScheduleExecution[]; totalItems: number }> {
        await this.getOrThrow(ctx, scheduleId);
        const [items, totalItems] = await this.connection.getRepository(ctx, ProductLaunchScheduleExecution).findAndCount({
            where: { scheduleId },
            order: { executedAt: 'DESC', id: 'DESC' },
            skip: Math.max(options.skip ?? 0, 0),
            take: Math.min(Math.max(options.take ?? DEFAULT_TAKE, 1), MAX_TAKE),
        });
        return { items, totalItems };
    }

    previewTime(localTime: string, timezone: string): ProductLaunchTimePreview {
        const result = localTimeToInstant(localTime, timezone);
        if (result.ok) {
            return { valid: true, instant: result.instant, ambiguous: result.ambiguous };
        }
        return {
            valid: false,
            ambiguous: false,
            errorCode: result.reason === 'INVALID_FORMAT' ? 'INVALID_INPUT' : result.reason,
            nextValidLocalTime: result.nextValidLocalTime,
        };
    }

    async create(ctx: RequestContext, input: CreateProductLaunchScheduleInput, now = new Date()): Promise<ProductLaunchSchedule> {
        const product = await this.getProductInChannel(ctx, input.productId);
        if (!input.endAt && input.endAction) {
            throw new ProductLaunchScheduleError('INVALID_INPUT', 'endAction requires endAt.');
        }
        const times = this.resolveTimes(input.scheduledAt, input.endAt ?? null, input.timezone, now);
        await this.assertNoConflict(ctx, product.id, times.scheduledAt, times.endAt);

        const schedule = await this.connection.getRepository(ctx, ProductLaunchSchedule).save(
            new ProductLaunchSchedule({
                productId: product.id,
                name: input.name ?? null,
                description: input.description ?? null,
                action: input.action,
                scheduledAt: times.scheduledAt,
                endAt: times.endAt,
                endAction: times.endAt ? (input.endAction ?? 'DISABLE') : null,
                timezone: input.timezone,
                localScheduledAt: input.scheduledAt,
                localEndAt: times.endAt ? input.endAt! : null,
                status: 'PENDING',
                nextStep: 'START',
                nextRunAt: times.scheduledAt,
                attempts: 0,
                revision: 0,
                leaseExpiresAt: null,
                startEnabledBefore: null,
                startEnabledAfter: null,
                lastExecutedAt: null,
                lastError: null,
                createdByUserId: ctx.activeUserId ?? null,
            }),
        );
        await this.eventBus.publish(new ProductLaunchScheduleEvent(ctx, schedule, 'created'));
        return schedule;
    }

    async update(ctx: RequestContext, input: UpdateProductLaunchScheduleInput, now = new Date()): Promise<ProductLaunchSchedule> {
        const schedule = await this.getOrThrow(ctx, input.id);
        const editable = editableFields(schedule.status);
        if (editable === 'none') {
            throw new ProductLaunchScheduleError(
                'INVALID_STATUS_TRANSITION',
                `A ${schedule.status} schedule cannot be changed.`,
            );
        }
        const startFields = ['action', 'scheduledAt', 'timezone'] as const;
        if (editable === 'end' && startFields.some(field => input[field] !== undefined && input[field] !== null)) {
            throw new ProductLaunchScheduleError(
                'INVALID_STATUS_TRANSITION',
                'The schedule has started: only its end time, end action, name and description can be changed.',
            );
        }
        if (input.removeEnd && (input.endAt || input.endAction)) {
            throw new ProductLaunchScheduleError('INVALID_INPUT', 'removeEnd cannot be combined with endAt or endAction.');
        }

        const timezone = input.timezone ?? schedule.timezone;
        const localStart = input.scheduledAt ?? schedule.localScheduledAt;
        const localEnd = input.removeEnd ? null : (input.endAt ?? schedule.localEndAt);
        const endAction: ProductLaunchEndAction | null = localEnd
            ? (input.endAction ?? schedule.endAction ?? 'DISABLE')
            : null;
        if (!localEnd && input.endAction) {
            throw new ProductLaunchScheduleError('INVALID_INPUT', 'endAction requires an end time.');
        }

        const changes: Partial<ProductLaunchSchedule> = {
            name: input.name !== undefined ? input.name : schedule.name,
            description: input.description !== undefined ? input.description : schedule.description,
        };
        if (editable === 'all') {
            const times = this.resolveTimes(localStart, localEnd, timezone, now);
            await this.assertNoConflict(ctx, schedule.productId, times.scheduledAt, times.endAt, schedule.id);
            Object.assign(changes, {
                action: input.action ?? schedule.action,
                timezone,
                scheduledAt: times.scheduledAt,
                localScheduledAt: localStart,
                endAt: times.endAt,
                localEndAt: localEnd,
                endAction,
                nextRunAt: times.scheduledAt,
                attempts: 0,
            });
        } else {
            // ACTIVE: the start step ran, only the end can change.
            if (localEnd) {
                const endAt = this.toInstant(localEnd, timezone);
                this.assertNotPast(endAt, now, 'end');
                if (endAt.getTime() <= schedule.scheduledAt.getTime()) {
                    throw new ProductLaunchScheduleError('END_BEFORE_START', 'The end time must be after the start time.');
                }
                await this.assertNoConflict(ctx, schedule.productId, schedule.scheduledAt, endAt, schedule.id);
                Object.assign(changes, { endAt, localEndAt: localEnd, endAction, nextStep: 'END', nextRunAt: endAt, attempts: 0 });
            } else {
                // No end step left: the schedule is done.
                Object.assign(changes, {
                    endAt: null,
                    localEndAt: null,
                    endAction: null,
                    status: 'COMPLETED',
                    nextStep: null,
                    nextRunAt: null,
                });
            }
        }
        const updated = await this.applyChanges(ctx, schedule, changes);
        await this.eventBus.publish(new ProductLaunchScheduleEvent(ctx, updated, 'updated'));
        return updated;
    }

    async cancel(ctx: RequestContext, id: ID): Promise<ProductLaunchSchedule> {
        const schedule = await this.getOrThrow(ctx, id);
        if (!canCancel(schedule.status)) {
            throw new ProductLaunchScheduleError(
                'INVALID_STATUS_TRANSITION',
                `A ${schedule.status} schedule cannot be cancelled.`,
            );
        }
        const updated = await this.applyChanges(ctx, schedule, {
            status: 'CANCELLED',
            nextStep: null,
            nextRunAt: null,
        });
        await this.eventBus.publish(new ProductLaunchScheduleEvent(ctx, updated, 'cancelled'));
        return updated;
    }

    async retry(ctx: RequestContext, id: ID, now = new Date()): Promise<ProductLaunchSchedule> {
        const schedule = await this.getOrThrow(ctx, id);
        if (!canRetry(schedule.status) || !schedule.nextStep) {
            throw new ProductLaunchScheduleError(
                'INVALID_STATUS_TRANSITION',
                `Only a FAILED schedule can be retried (this one is ${schedule.status}).`,
            );
        }
        const updated = await this.applyChanges(ctx, schedule, {
            status: waitingStatusFor(schedule.nextStep),
            nextRunAt: now,
            attempts: 0,
        });
        await this.eventBus.publish(new ProductLaunchScheduleEvent(ctx, updated, 'retried'));
        return updated;
    }

    /**
     * Cancels the unfinished schedules of a deleted product. A schedule being processed right now
     * is cancelled by the executor, which checks the product itself.
     */
    async cancelForDeletedProduct(ctx: RequestContext, productId: ID): Promise<number> {
        const schedules = await this.connection.getRepository(ctx, ProductLaunchSchedule).find({
            where: { productId, status: In(['PENDING', 'ACTIVE']) },
        });
        let cancelled = 0;
        for (const schedule of schedules) {
            try {
                const updated = await this.applyChanges(ctx, schedule, {
                    status: 'CANCELLED',
                    nextStep: null,
                    nextRunAt: null,
                    lastError: 'The product was deleted.',
                });
                cancelled++;
                await this.eventBus.publish(new ProductLaunchScheduleEvent(ctx, updated, 'cancelled'));
            } catch {
                // claimed by a worker in the meantime: the executor cancels it
            }
        }
        return cancelled;
    }

    /** Applies `changes` only if nobody changed the schedule since it was read. */
    private async applyChanges(
        ctx: RequestContext,
        schedule: ProductLaunchSchedule,
        changes: Partial<ProductLaunchSchedule>,
    ): Promise<ProductLaunchSchedule> {
        const repository = this.connection.getRepository(ctx, ProductLaunchSchedule);
        const result = await repository.update(
            { id: schedule.id, revision: schedule.revision, status: schedule.status as ProductLaunchScheduleStatus },
            { ...changes, revision: schedule.revision + 1 },
        );
        if (result.affected !== 1) {
            throw new ProductLaunchScheduleError(
                'INVALID_STATUS_TRANSITION',
                'The schedule was changed at the same time (e.g. a step started running). Reload and try again.',
            );
        }
        return repository.findOneOrFail({ where: { id: schedule.id } });
    }

    private async getOrThrow(ctx: RequestContext, id: ID): Promise<ProductLaunchSchedule> {
        const schedule = await this.findOne(ctx, id);
        if (!schedule) {
            throw new EntityNotFoundError('ProductLaunchSchedule' as any, id);
        }
        return schedule;
    }

    private async getProductInChannel(ctx: RequestContext, productId: ID): Promise<Product> {
        try {
            return await this.connection.getEntityOrThrow(ctx, Product, productId, { channelId: ctx.channelId });
        } catch {
            throw new ProductLaunchScheduleError(
                'PRODUCT_NOT_FOUND',
                `No product with id ${this.apiId(productId)} in the active channel.`,
            );
        }
    }

    private channelScopedQuery(ctx: RequestContext) {
        return this.connection
            .getRepository(ctx, ProductLaunchSchedule)
            .createQueryBuilder('schedule')
            .innerJoin('schedule.product', 'product')
            .innerJoin('product.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId });
    }

    /** An id as API clients see it (encoded by the configured EntityIdStrategy). */
    private apiId(id: ID): string {
        const strategy = this.configService.entityOptions.entityIdStrategy;
        return strategy?.encodeId ? strategy.encodeId(id as any) : String(id);
    }

    private resolveTimes(localStart: string, localEnd: string | null, timezone: string, now: Date) {
        const scheduledAt = this.toInstant(localStart, timezone);
        this.assertNotPast(scheduledAt, now, 'start');
        let endAt: Date | null = null;
        if (localEnd) {
            endAt = this.toInstant(localEnd, timezone);
            if (endAt.getTime() <= scheduledAt.getTime()) {
                throw new ProductLaunchScheduleError('END_BEFORE_START', 'The end time must be after the start time.');
            }
        }
        return { scheduledAt, endAt };
    }

    private toInstant(localTime: string, timezone: string): Date {
        const result = localTimeToInstant(localTime, timezone);
        if (result.ok) {
            return result.instant;
        }
        if (result.reason === 'INVALID_TIMEZONE') {
            throw new ProductLaunchScheduleError('INVALID_TIMEZONE', `"${timezone}" is not a valid IANA time zone.`);
        }
        if (result.reason === 'INVALID_LOCAL_TIME') {
            throw new ProductLaunchScheduleError(
                'INVALID_LOCAL_TIME',
                `${localTime} does not exist in ${timezone} (the clocks skip it for daylight saving time).` +
                    (result.nextValidLocalTime ? ` The next valid time is ${result.nextValidLocalTime}.` : ''),
            );
        }
        throw new ProductLaunchScheduleError('INVALID_INPUT', `"${localTime}" is not a valid local time (YYYY-MM-DDTHH:mm).`);
    }

    private assertNotPast(instant: Date, now: Date, which: 'start' | 'end') {
        if (instant.getTime() < now.getTime() - PAST_GRACE_MS) {
            throw new ProductLaunchScheduleError('SCHEDULE_IN_PAST', `The ${which} time is in the past.`);
        }
    }

    private async assertNoConflict(ctx: RequestContext, productId: ID, start: Date, end: Date | null, excludeId?: ID) {
        const others = (
            await this.connection.getRepository(ctx, ProductLaunchSchedule).find({
                where: { productId, status: In(UNFINISHED_STATUSES) },
            })
        ).filter(other => excludeId === undefined || String(other.id) !== String(excludeId));
        const conflict = findConflict(
            { start, end },
            others.map(other => ({ start: other.scheduledAt, end: other.endAt, schedule: other })),
        );
        if (conflict) {
            const other = conflict.schedule;
            const range = other.localEndAt
                ? `${other.localScheduledAt} – ${other.localEndAt}`
                : other.localScheduledAt;
            throw new ProductLaunchScheduleError(
                'SCHEDULE_CONFLICT',
                `Overlaps schedule ${this.apiId(other.id)}${other.name ? ` ("${other.name}")` : ''} (${range} ${other.timezone}, ${other.status}).`,
                { conflictingScheduleId: this.apiId(other.id) },
            );
        }
    }
}
