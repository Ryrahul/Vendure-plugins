/**
 * Pure scheduling rules: no database, no Vendure services. Unit-tested in schedule-rules.spec.ts.
 */

export type ProductLaunchAction = 'ENABLE' | 'DISABLE';
export type ProductLaunchEndAction = 'ENABLE' | 'DISABLE' | 'RESTORE';
export type ProductLaunchStep = 'START' | 'END';
export type ProductLaunchScheduleStatus = 'PENDING' | 'PROCESSING' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type ProductLaunchExecutionOutcome = 'SUCCEEDED' | 'NO_CHANGE' | 'SKIPPED' | 'FAILED';

/** Statuses of schedules that still have a step to run. They take part in conflict checks. */
export const UNFINISHED_STATUSES: ProductLaunchScheduleStatus[] = ['PENDING', 'PROCESSING', 'ACTIVE'];

/** Delay before retrying a failed step, by attempt number (1-based). The last value repeats. */
export const RETRY_BACKOFF_SECONDS = [60, 300, 900];

/** Times up to this far in the past are accepted (the step then runs at the next poll). */
export const PAST_GRACE_MS = 60_000;

export interface TimeRange {
    start: Date;
    /** `null` for a schedule without an end step: it occupies the single instant `start`. */
    end: Date | null;
}

/** Whether two schedule time ranges overlap. Ranges are closed: touching counts as overlapping. */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
    const aEnd = (a.end ?? a.start).getTime();
    const bEnd = (b.end ?? b.start).getTime();
    return a.start.getTime() <= bEnd && b.start.getTime() <= aEnd;
}

/** The first schedule whose range overlaps `candidate`, if any. */
export function findConflict<T extends TimeRange>(candidate: TimeRange, others: T[]): T | undefined {
    return others.find(other => rangesOverlap(candidate, other));
}

export function retryDelaySeconds(attempt: number): number {
    return RETRY_BACKOFF_SECONDS[Math.min(Math.max(attempt, 1), RETRY_BACKOFF_SECONDS.length) - 1];
}

/** The status a schedule returns to while it waits for `step` (after a retry or a released lease). */
export function waitingStatusFor(step: ProductLaunchStep): ProductLaunchScheduleStatus {
    return step === 'START' ? 'PENDING' : 'ACTIVE';
}

/** The `enabled` value the start step sets. */
export function startTarget(action: ProductLaunchAction): boolean {
    return action === 'ENABLE';
}

export type EndDecision =
    | { apply: true; target: boolean }
    | { apply: false; reason: string };

/**
 * What the end step does.
 *
 * - `ENABLE` / `DISABLE` express intent and always apply.
 * - `RESTORE` puts back the value from before the start step, but only if the product still has
 *   the value the start step set. If someone changed it in between, nothing stale is restored.
 */
export function decideEnd(
    endAction: ProductLaunchEndAction,
    current: boolean,
    startEnabledBefore: boolean | null,
    startEnabledAfter: boolean | null,
): EndDecision {
    if (endAction === 'ENABLE' || endAction === 'DISABLE') {
        return { apply: true, target: endAction === 'ENABLE' };
    }
    if (startEnabledBefore === null || startEnabledAfter === null) {
        return { apply: false, reason: 'The start step did not record the previous state, nothing to restore.' };
    }
    if (current !== startEnabledAfter) {
        return { apply: false, reason: 'The product was changed manually after the start step; it was not restored.' };
    }
    return { apply: true, target: startEnabledBefore };
}

/** Which fields of a schedule may be changed in a given status. */
export function editableFields(status: ProductLaunchScheduleStatus): 'all' | 'end' | 'none' {
    if (status === 'PENDING') {
        return 'all';
    }
    if (status === 'ACTIVE') {
        return 'end';
    }
    return 'none';
}

export function canCancel(status: ProductLaunchScheduleStatus): boolean {
    return status === 'PENDING' || status === 'ACTIVE';
}

export function canRetry(status: ProductLaunchScheduleStatus): boolean {
    return status === 'FAILED';
}
