import { Inject, Injectable } from '@nestjs/common';
import {
    ChannelService,
    EventBus,
    Logger,
    Product,
    ProductService,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { In, LessThan, LessThanOrEqual } from 'typeorm';

import { loggerCtx, PRODUCT_LAUNCH_SCHEDULER_OPTIONS } from '../constants';
import { ProductLaunchScheduleExecution } from '../entities/product-launch-schedule-execution.entity';
import { ProductLaunchSchedule } from '../entities/product-launch-schedule.entity';
import { ProductLaunchScheduleEvent } from '../events/product-launch-schedule.event';
import { ResolvedProductLaunchSchedulerOptions } from '../types';

import {
    decideEnd,
    ProductLaunchExecutionOutcome,
    ProductLaunchStep,
    retryDelaySeconds,
    startTarget,
    waitingStatusFor,
} from './schedule-rules';

export interface ProcessDueResult {
    /** Schedules whose step ran (successfully or not). */
    processed: number;
    succeeded: number;
    failed: number;
    /** Schedules released after their lease expired (e.g. a crashed worker). */
    released: number;
}

interface StepResult {
    outcome: ProductLaunchExecutionOutcome;
    message: string | null;
    enabledBefore: boolean | null;
    enabledAfter: boolean | null;
    changes: Partial<ProductLaunchSchedule>;
}

/**
 * Runs due schedule steps. Called by the plugin's scheduled task on the worker.
 *
 * Each due schedule is first claimed with a single conditional UPDATE (status, revision), so
 * when several workers run at once, exactly one of them runs a given step. A step sets a desired
 * value (`enabled = true/false`), so running it again after a crash is harmless: the second run
 * records `NO_CHANGE`.
 */
@Injectable()
export class ProductLaunchExecutorService {
    constructor(
        private connection: TransactionalConnection,
        private productService: ProductService,
        private requestContextService: RequestContextService,
        private channelService: ChannelService,
        private eventBus: EventBus,
        @Inject(PRODUCT_LAUNCH_SCHEDULER_OPTIONS) private options: ResolvedProductLaunchSchedulerOptions,
    ) {}

    async processDue(now = new Date()): Promise<ProcessDueResult> {
        const ctx = await this.requestContextService.create({
            apiType: 'admin',
            channelOrToken: await this.channelService.getDefaultChannel(),
        });
        const result: ProcessDueResult = { processed: 0, succeeded: 0, failed: 0, released: 0 };
        result.released = await this.releaseExpiredLeases(ctx, now);

        const due = await this.connection.rawConnection.getRepository(ProductLaunchSchedule).find({
            where: { status: In(['PENDING', 'ACTIVE']), nextRunAt: LessThanOrEqual(now) },
            order: { nextRunAt: 'ASC', id: 'ASC' },
            take: this.options.batchSize,
        });
        for (const candidate of due) {
            const schedule = await this.claim(candidate, now);
            if (!schedule) {
                continue;
            }
            result.processed++;
            const ok = await this.runStep(ctx, schedule, now);
            if (ok) {
                result.succeeded++;
            } else {
                result.failed++;
            }
        }
        if (result.processed || result.released) {
            Logger.verbose(
                `Processed ${result.processed} schedule(s): ${result.succeeded} succeeded, ${result.failed} failed, ${result.released} released`,
                loggerCtx,
            );
        }
        return result;
    }

    /** Claims a due schedule for this worker. Returns undefined if another one got it first. */
    private async claim(candidate: ProductLaunchSchedule, now: Date): Promise<ProductLaunchSchedule | undefined> {
        const repository = this.connection.rawConnection.getRepository(ProductLaunchSchedule);
        const result = await repository
            .createQueryBuilder()
            .update(ProductLaunchSchedule)
            .set({
                status: 'PROCESSING',
                leaseExpiresAt: new Date(now.getTime() + this.options.leaseSeconds * 1000),
                attempts: () => 'attempts + 1',
                revision: () => 'revision + 1',
            })
            .where('id = :id AND revision = :revision AND status = :status', {
                id: candidate.id,
                revision: candidate.revision,
                status: candidate.status,
            })
            .execute();
        if (result.affected !== 1) {
            return undefined;
        }
        return (await repository.findOne({ where: { id: candidate.id } })) ?? undefined;
    }

    /** Runs the claimed schedule's next step. Returns false if it failed. */
    private async runStep(ctx: RequestContext, schedule: ProductLaunchSchedule, now: Date): Promise<boolean> {
        const step = schedule.nextStep as ProductLaunchStep;
        const dueAt = step === 'START' ? schedule.scheduledAt : (schedule.endAt ?? schedule.scheduledAt);
        const ranLateBySeconds = Math.max(0, Math.round((now.getTime() - dueAt.getTime()) / 1000));
        const stepAction = step === 'START' ? schedule.action : (schedule.endAction ?? 'DISABLE');

        if (
            this.options.skipIfLateBy !== undefined &&
            schedule.attempts === 1 &&
            ranLateBySeconds > this.options.skipIfLateBy
        ) {
            const message = `Missed: due ${ranLateBySeconds}s ago, more than skipIfLateBy (${this.options.skipIfLateBy}s).`;
            await this.finish(ctx, schedule, now, ranLateBySeconds, stepAction, {
                outcome: 'SKIPPED',
                message,
                enabledBefore: null,
                enabledAfter: null,
                changes: { status: 'FAILED', lastError: message },
            });
            await this.eventBus.publish(new ProductLaunchScheduleEvent(ctx, schedule, 'failed', step, 'SKIPPED'));
            return false;
        }

        try {
            const updated = await this.connection.withTransaction(ctx, async txCtx => {
                const result = await this.applyStep(txCtx, schedule, step);
                return this.finish(txCtx, schedule, now, ranLateBySeconds, stepAction, result);
            });
            await this.eventBus.publish(
                new ProductLaunchScheduleEvent(ctx, updated.schedule, updated.schedule.status === 'CANCELLED' ? 'cancelled' : 'executed', step, updated.outcome),
            );
            return true;
        } catch (e: any) {
            return this.handleFailure(ctx, schedule, step, stepAction, now, ranLateBySeconds, e);
        }
    }

    private async applyStep(ctx: RequestContext, schedule: ProductLaunchSchedule, step: ProductLaunchStep): Promise<StepResult> {
        const product = await this.connection.getRepository(ctx, Product).findOne({ where: { id: schedule.productId } });
        if (!product || product.deletedAt) {
            return {
                outcome: 'SKIPPED',
                message: 'The product was deleted; the schedule was cancelled.',
                enabledBefore: null,
                enabledAfter: null,
                changes: { status: 'CANCELLED', nextStep: null, nextRunAt: null, lastError: 'The product was deleted.' },
            };
        }
        const before = product.enabled;

        if (step === 'START') {
            const target = startTarget(schedule.action);
            const changed = await this.setEnabled(ctx, product, target);
            return {
                outcome: changed ? 'SUCCEEDED' : 'NO_CHANGE',
                message: null,
                enabledBefore: before,
                enabledAfter: target,
                changes: {
                    startEnabledBefore: before,
                    startEnabledAfter: target,
                    status: schedule.endAt ? 'ACTIVE' : 'COMPLETED',
                    nextStep: schedule.endAt ? 'END' : null,
                    nextRunAt: schedule.endAt ?? null,
                    lastError: null,
                },
            };
        }

        const decision = decideEnd(
            schedule.endAction ?? 'DISABLE',
            before,
            schedule.startEnabledBefore,
            schedule.startEnabledAfter,
        );
        const done: Partial<ProductLaunchSchedule> = { status: 'COMPLETED', nextStep: null, nextRunAt: null, lastError: null };
        if (!decision.apply) {
            return { outcome: 'SKIPPED', message: decision.reason, enabledBefore: before, enabledAfter: before, changes: done };
        }
        const changed = await this.setEnabled(ctx, product, decision.target);
        return {
            outcome: changed ? 'SUCCEEDED' : 'NO_CHANGE',
            message: null,
            enabledBefore: before,
            enabledAfter: decision.target,
            changes: done,
        };
    }

    /** Sets `Product.enabled` through ProductService (events, search index). Returns whether it changed. */
    private async setEnabled(ctx: RequestContext, product: Product, enabled: boolean): Promise<boolean> {
        if (product.enabled === enabled) {
            return false;
        }
        await this.productService.update(ctx, { id: product.id, enabled });
        return true;
    }

    /** Records the execution and moves the schedule on. */
    private async finish(
        ctx: RequestContext,
        schedule: ProductLaunchSchedule,
        now: Date,
        ranLateBySeconds: number,
        stepAction: string,
        result: StepResult,
    ): Promise<{ schedule: ProductLaunchSchedule; outcome: ProductLaunchExecutionOutcome }> {
        await this.connection.getRepository(ctx, ProductLaunchScheduleExecution).save(
            new ProductLaunchScheduleExecution({
                scheduleId: schedule.id,
                step: schedule.nextStep as ProductLaunchStep,
                action: stepAction,
                outcome: result.outcome,
                enabledBefore: result.enabledBefore,
                enabledAfter: result.enabledAfter,
                attempt: schedule.attempts,
                message: result.message,
                ranLateBySeconds,
                executedAt: now,
            }),
        );
        const repository = this.connection.getRepository(ctx, ProductLaunchSchedule);
        await repository.update(
            { id: schedule.id, status: 'PROCESSING', revision: schedule.revision },
            {
                ...result.changes,
                attempts: result.outcome === 'FAILED' ? schedule.attempts : 0,
                leaseExpiresAt: null,
                lastExecutedAt: now,
                revision: schedule.revision + 1,
            },
        );
        return { schedule: await repository.findOneOrFail({ where: { id: schedule.id } }), outcome: result.outcome };
    }

    private async handleFailure(
        ctx: RequestContext,
        schedule: ProductLaunchSchedule,
        step: ProductLaunchStep,
        stepAction: string,
        now: Date,
        ranLateBySeconds: number,
        error: any,
    ): Promise<false> {
        const message = String(error?.message ?? error).slice(0, 1000);
        const permanent = schedule.attempts >= this.options.maxAttempts;
        Logger.error(
            `Schedule ${String(schedule.id)} (product ${String(schedule.productId)}): ${step} step failed ` +
                `(attempt ${schedule.attempts}/${this.options.maxAttempts}): ${message}`,
            loggerCtx,
            error?.stack,
        );
        try {
            const updated = await this.finish(ctx, schedule, now, ranLateBySeconds, stepAction, {
                outcome: 'FAILED',
                message,
                enabledBefore: null,
                enabledAfter: null,
                changes: permanent
                    ? { status: 'FAILED', lastError: message }
                    : {
                          status: waitingStatusFor(step),
                          nextRunAt: new Date(now.getTime() + retryDelaySeconds(schedule.attempts) * 1000),
                          lastError: message,
                      },
            });
            if (permanent) {
                await this.eventBus.publish(new ProductLaunchScheduleEvent(ctx, updated.schedule, 'failed', step, 'FAILED'));
            }
        } catch (e: any) {
            // The lease expires and the step runs again; nothing else to do.
            Logger.error(`Could not record the failure of schedule ${String(schedule.id)}: ${e?.message}`, loggerCtx);
        }
        return false;
    }

    /**
     * Puts schedules whose worker disappeared (lease expired while PROCESSING) back in the queue,
     * or marks them FAILED when they have used all their attempts.
     */
    private async releaseExpiredLeases(ctx: RequestContext, now: Date): Promise<number> {
        const repository = this.connection.rawConnection.getRepository(ProductLaunchSchedule);
        const stuck = await repository.find({ where: { status: 'PROCESSING', leaseExpiresAt: LessThan(now) } });
        let released = 0;
        for (const schedule of stuck) {
            const step = (schedule.nextStep ?? 'START') as ProductLaunchStep;
            const permanent = schedule.attempts >= this.options.maxAttempts;
            const message = 'The worker running this step stopped before finishing (lease expired).';
            const result = await repository.update(
                { id: schedule.id, status: 'PROCESSING', revision: schedule.revision },
                {
                    status: permanent ? 'FAILED' : waitingStatusFor(step),
                    nextRunAt: permanent ? schedule.nextRunAt : now,
                    leaseExpiresAt: null,
                    lastError: message,
                    revision: schedule.revision + 1,
                },
            );
            if (result.affected === 1) {
                released++;
                Logger.warn(`Released schedule ${String(schedule.id)}: ${message}`, loggerCtx);
                if (permanent) {
                    const updated = await repository.findOneOrFail({ where: { id: schedule.id } });
                    await this.eventBus.publish(new ProductLaunchScheduleEvent(ctx, updated, 'failed', step, 'FAILED'));
                }
            }
        }
        return released;
    }
}
