import { describe, expect, it } from 'vitest';

import { formatLocalTime, isValidTimeZone, localTimeToInstant } from './zoned-time';

const utc = (result: ReturnType<typeof localTimeToInstant>) => (result.ok ? result.instant.toISOString() : result);

describe('localTimeToInstant()', () => {
    it('converts a normal local time', () => {
        expect(utc(localTimeToInstant('2026-11-02T10:00', 'Europe/Berlin'))).toBe('2026-11-02T09:00:00.000Z');
        expect(utc(localTimeToInstant('2026-07-01T10:00', 'Europe/Berlin'))).toBe('2026-07-01T08:00:00.000Z');
        expect(utc(localTimeToInstant('2026-07-01T10:00', 'America/New_York'))).toBe('2026-07-01T14:00:00.000Z');
        expect(utc(localTimeToInstant('2026-07-01T10:00', 'UTC'))).toBe('2026-07-01T10:00:00.000Z');
    });

    it('handles zones with non-hour offsets', () => {
        expect(utc(localTimeToInstant('2026-07-01T10:00', 'Asia/Kathmandu'))).toBe('2026-07-01T04:15:00.000Z');
        expect(utc(localTimeToInstant('2026-07-01T10:00', 'Asia/Kolkata'))).toBe('2026-07-01T04:30:00.000Z');
    });

    it('handles dates across the international date line', () => {
        expect(utc(localTimeToInstant('2026-01-01T00:30', 'Pacific/Auckland'))).toBe('2025-12-31T11:30:00.000Z');
    });

    it('rejects a time skipped by DST (spring forward) and suggests the next valid one', () => {
        // Berlin: 2026-03-29 02:00 → 03:00
        const result = localTimeToInstant('2026-03-29T02:30', 'Europe/Berlin');
        expect(result).toEqual({ ok: false, reason: 'INVALID_LOCAL_TIME', nextValidLocalTime: '2026-03-29T03:00' });
        // New York: 2026-03-08 02:00 → 03:00
        expect(localTimeToInstant('2026-03-08T02:15', 'America/New_York')).toMatchObject({ ok: false, reason: 'INVALID_LOCAL_TIME' });
    });

    it('resolves a time that happens twice (fall back) to the earlier instant', () => {
        // Berlin: 2026-10-25 03:00 → 02:00, so 02:30 happens at 00:30Z and 01:30Z
        const result = localTimeToInstant('2026-10-25T02:30', 'Europe/Berlin');
        expect(result).toEqual({ ok: true, instant: new Date('2026-10-25T00:30:00.000Z'), ambiguous: true });
    });

    it('is not ambiguous right next to a transition', () => {
        expect(localTimeToInstant('2026-10-25T03:00', 'Europe/Berlin')).toEqual({
            ok: true,
            instant: new Date('2026-10-25T02:00:00.000Z'),
            ambiguous: false,
        });
        expect(utc(localTimeToInstant('2026-03-29T03:00', 'Europe/Berlin'))).toBe('2026-03-29T01:00:00.000Z');
        expect(utc(localTimeToInstant('2026-03-29T01:59', 'Europe/Berlin'))).toBe('2026-03-29T00:59:00.000Z');
    });

    it('rejects malformed input', () => {
        for (const value of ['2026-11-02', '2026-11-02 10:00', '2026-13-01T10:00', '2026-02-30T10:00', '2026-11-02T24:00', '2026-11-02T10:60', '']) {
            expect(localTimeToInstant(value, 'UTC')).toEqual({ ok: false, reason: 'INVALID_FORMAT' });
        }
    });

    it('rejects an unknown time zone', () => {
        expect(localTimeToInstant('2026-11-02T10:00', 'Mars/Olympus')).toEqual({ ok: false, reason: 'INVALID_TIMEZONE' });
        expect(localTimeToInstant('2026-11-02T10:00', '')).toEqual({ ok: false, reason: 'INVALID_TIMEZONE' });
    });

    it('round-trips with formatLocalTime for every hour of a DST year', () => {
        for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 3_600_000) {
            const local = formatLocalTime(new Date(t), 'Europe/Berlin');
            const back = localTimeToInstant(local, 'Europe/Berlin');
            expect(back.ok).toBe(true);
            // in the repeated hour the earlier instant is chosen
            if (back.ok && !back.ambiguous) {
                expect(back.instant.getTime()).toBe(t);
            }
        }
    });
});

describe('isValidTimeZone()', () => {
    it('accepts IANA zones and rejects others', () => {
        expect(isValidTimeZone('Europe/Berlin')).toBe(true);
        expect(isValidTimeZone('UTC')).toBe(true);
        expect(isValidTimeZone('Not/AZone')).toBe(false);
    });
});
