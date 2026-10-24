/**
 * Conversion between wall-clock times in an IANA time zone and UTC instants, using only
 * `Intl` (no dependency, and never the server's own time zone).
 *
 * Local times are minute-precision strings in the form `YYYY-MM-DDTHH:mm`.
 */

const LOCAL_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type LocalTimeResult =
    | {
          ok: true;
          instant: Date;
          /** The local time happens twice (DST fall-back); `instant` is the earlier one. */
          ambiguous: boolean;
      }
    | {
          ok: false;
          reason: 'INVALID_FORMAT' | 'INVALID_TIMEZONE' | 'INVALID_LOCAL_TIME';
          /** For a time skipped by a DST change: the first valid local time after it. */
          nextValidLocalTime?: string;
      };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
    let f = formatters.get(timeZone);
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
        formatters.set(timeZone, f);
    }
    return f;
}

/** `true` for a time zone `Intl` knows, e.g. `Europe/Berlin` or `UTC`. */
export function isValidTimeZone(timeZone: string): boolean {
    if (!timeZone) {
        return false;
    }
    try {
        formatter(timeZone);
        return true;
    } catch {
        return false;
    }
}

function wallClock(instant: number, timeZone: string) {
    const parts: Record<string, number> = {};
    for (const part of formatter(timeZone).formatToParts(new Date(instant))) {
        if (part.type !== 'literal') {
            parts[part.type] = Number(part.value);
        }
    }
    return parts as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** The wall-clock time of `instant` in `timeZone`, as `YYYY-MM-DDTHH:mm`. */
export function formatLocalTime(instant: Date, timeZone: string): string {
    const w = wallClock(instant.getTime(), timeZone);
    const pad = (n: number, len = 2) => String(n).padStart(len, '0');
    return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** The zone's offset from UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
    const w = wallClock(instant, timeZone);
    const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The UTC instant at which the wall clock in `timeZone` shows `localTime`.
 *
 * - A local time skipped by a DST change (spring forward) is rejected with
 *   `INVALID_LOCAL_TIME`, and `nextValidLocalTime` suggests the first valid time after it.
 * - A local time that happens twice (fall back) resolves to the earlier instant.
 */
export function localTimeToInstant(localTime: string, timeZone: string): LocalTimeResult {
    const result = convert(localTime, timeZone);
    if (!result.ok && result.reason === 'INVALID_LOCAL_TIME') {
        const naive = Date.parse(`${localTime}:00Z`);
        return { ...result, nextValidLocalTime: nextValidLocalTime(naive, timeZone) };
    }
    return result;
}

function convert(localTime: string, timeZone: string): LocalTimeResult {
    if (!isValidTimeZone(timeZone)) {
        return { ok: false, reason: 'INVALID_TIMEZONE' };
    }
    const match = LOCAL_TIME_PATTERN.exec(localTime ?? '');
    if (!match) {
        return { ok: false, reason: 'INVALID_FORMAT' };
    }
    const [year, month, day, hour, minute] = match.slice(1).map(Number);
    const naive = Date.UTC(year, month - 1, day, hour, minute);
    const check = new Date(naive);
    if (
        check.getUTCFullYear() !== year ||
        check.getUTCMonth() !== month - 1 ||
        check.getUTCDate() !== day ||
        hour > 23 ||
        minute > 59
    ) {
        return { ok: false, reason: 'INVALID_FORMAT' };
    }

    // The offsets in force a day before and a day after cover any single transition.
    const offsets = new Set([offsetAt(naive - DAY, timeZone), offsetAt(naive + DAY, timeZone), offsetAt(naive, timeZone)]);
    const candidates = [...offsets]
        .map(offset => naive - offset)
        .filter(instant => formatLocalTime(new Date(instant), timeZone) === localTime)
        .sort((a, b) => a - b);
    const unique = [...new Set(candidates)];

    if (!unique.length) {
        return { ok: false, reason: 'INVALID_LOCAL_TIME' };
    }
    return { ok: true, instant: new Date(unique[0]), ambiguous: unique.length > 1 };
}

function nextValidLocalTime(naive: number, timeZone: string): string | undefined {
    for (let i = 1; i <= 24 * 60; i++) {
        const candidate = new Date(naive + i * MINUTE).toISOString().slice(0, 16);
        if (convert(candidate, timeZone).ok) {
            return candidate;
        }
    }
    return undefined;
}
