/**
 * Options for {@link ProductLaunchSchedulerPlugin}.
 */
export interface ProductLaunchSchedulerOptions {
    /**
     * How often due schedules are processed, as a cron expression (6 fields allow seconds).
     * A step runs at most this long after its scheduled time.
     *
     * @default '* * * * *' (every minute)
     */
    pollSchedule?: string;
    /**
     * Maximum number of due schedules processed per run. The rest are picked up by the next run.
     *
     * @default 50
     */
    batchSize?: number;
    /**
     * Attempts per step before a schedule is marked `FAILED`. Retries wait 1, 5, then 15 minutes.
     *
     * @default 3
     */
    maxAttempts?: number;
    /**
     * How long a worker may hold a schedule while running a step. A schedule still `PROCESSING`
     * after this (e.g. the worker crashed) is released and run again.
     *
     * @default 300
     */
    leaseSeconds?: number;
    /**
     * When set, a step that is due more than this many seconds ago (e.g. the worker was down) is
     * not run, and the schedule is marked `FAILED` ("missed") instead. By default late steps run
     * as soon as possible.
     *
     * @default undefined (run late steps)
     */
    skipIfLateBy?: number;
}

export type ResolvedProductLaunchSchedulerOptions = Required<Omit<ProductLaunchSchedulerOptions, 'skipIfLateBy'>> &
    Pick<ProductLaunchSchedulerOptions, 'skipIfLateBy'>;

export const defaultOptions: ResolvedProductLaunchSchedulerOptions = {
    pollSchedule: '* * * * *',
    batchSize: 50,
    maxAttempts: 3,
    leaseSeconds: 300,
    skipIfLateBy: undefined,
};
