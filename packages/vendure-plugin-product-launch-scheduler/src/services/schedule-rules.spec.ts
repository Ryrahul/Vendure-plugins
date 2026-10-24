import { describe, expect, it } from 'vitest';

import {
    canCancel,
    canRetry,
    decideEnd,
    editableFields,
    findConflict,
    rangesOverlap,
    retryDelaySeconds,
    startTarget,
    waitingStatusFor,
} from './schedule-rules';

const d = (iso: string) => new Date(iso);

describe('rangesOverlap()', () => {
    const window = { start: d('2026-11-02T10:00Z'), end: d('2026-11-05T10:00Z') };

    it('detects nested, partial and identical ranges', () => {
        expect(rangesOverlap(window, { start: d('2026-11-03T00:00Z'), end: d('2026-11-04T00:00Z') })).toBe(true);
        expect(rangesOverlap(window, { start: d('2026-11-01T00:00Z'), end: d('2026-11-03T00:00Z') })).toBe(true);
        expect(rangesOverlap(window, { ...window })).toBe(true);
    });

    it('treats a schedule without end as a single instant', () => {
        expect(rangesOverlap(window, { start: d('2026-11-04T00:00Z'), end: null })).toBe(true);
        expect(rangesOverlap(window, { start: d('2026-11-06T00:00Z'), end: null })).toBe(false);
        expect(rangesOverlap({ start: d('2026-11-06T00:00Z'), end: null }, { start: d('2026-11-06T00:00Z'), end: null })).toBe(true);
    });

    it('treats touching ranges as overlapping (two steps at the same instant)', () => {
        expect(rangesOverlap(window, { start: d('2026-11-05T10:00Z'), end: null })).toBe(true);
    });

    it('allows sequential schedules', () => {
        expect(rangesOverlap({ start: d('2026-11-02T10:00Z'), end: null }, { start: d('2026-11-06T10:00Z'), end: null })).toBe(false);
        expect(rangesOverlap(window, { start: d('2026-11-05T10:01Z'), end: d('2026-11-08T00:00Z') })).toBe(false);
    });
});

describe('findConflict()', () => {
    it('returns the first overlapping schedule', () => {
        const others = [
            { id: 1, start: d('2026-11-01T00:00Z'), end: null },
            { id: 2, start: d('2026-11-03T00:00Z'), end: d('2026-11-04T00:00Z') },
        ];
        expect(findConflict({ start: d('2026-11-03T12:00Z'), end: null }, others)?.id).toBe(2);
        expect(findConflict({ start: d('2026-11-10T00:00Z'), end: null }, others)).toBeUndefined();
    });
});

describe('decideEnd()', () => {
    it('applies explicit end actions whatever the current state', () => {
        expect(decideEnd('DISABLE', true, false, true)).toEqual({ apply: true, target: false });
        expect(decideEnd('DISABLE', false, false, true)).toEqual({ apply: true, target: false });
        expect(decideEnd('ENABLE', false, null, null)).toEqual({ apply: true, target: true });
    });

    it('restores the state from before the start step', () => {
        expect(decideEnd('RESTORE', true, false, true)).toEqual({ apply: true, target: false });
        expect(decideEnd('RESTORE', false, true, false)).toEqual({ apply: true, target: true });
        // the start step was a no-op: restoring keeps the same value
        expect(decideEnd('RESTORE', true, true, true)).toEqual({ apply: true, target: true });
    });

    it('does not restore when the product was changed manually in between', () => {
        expect(decideEnd('RESTORE', false, false, true)).toMatchObject({ apply: false });
    });

    it('does not restore without a recorded start state', () => {
        expect(decideEnd('RESTORE', true, null, null)).toMatchObject({ apply: false });
    });
});

describe('status rules', () => {
    it('maps steps to waiting statuses', () => {
        expect(waitingStatusFor('START')).toBe('PENDING');
        expect(waitingStatusFor('END')).toBe('ACTIVE');
    });

    it('limits edits by status', () => {
        expect(editableFields('PENDING')).toBe('all');
        expect(editableFields('ACTIVE')).toBe('end');
        for (const status of ['PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const) {
            expect(editableFields(status)).toBe('none');
        }
    });

    it('allows cancel only for unfinished, idle schedules and retry only for failed ones', () => {
        expect(canCancel('PENDING')).toBe(true);
        expect(canCancel('ACTIVE')).toBe(true);
        expect(canCancel('PROCESSING')).toBe(false);
        expect(canCancel('COMPLETED')).toBe(false);
        expect(canRetry('FAILED')).toBe(true);
        expect(canRetry('CANCELLED')).toBe(false);
    });

    it('backs off 1, 5, then 15 minutes', () => {
        expect([1, 2, 3, 4].map(retryDelaySeconds)).toEqual([60, 300, 900, 900]);
    });

    it('maps actions to target values', () => {
        expect(startTarget('ENABLE')).toBe(true);
        expect(startTarget('DISABLE')).toBe(false);
    });
});
