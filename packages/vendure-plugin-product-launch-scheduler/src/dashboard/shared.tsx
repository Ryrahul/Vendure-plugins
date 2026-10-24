import { useQuery } from '@tanstack/react-query';
import { api, useAuth, useChannel } from '@vendure/dashboard';
import { AlertTriangle, Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { productLaunchSchedulerStatusQuery } from './launch-schedules.graphql';

// Only primitives whose API is identical in @vendure-io/ui 1.x (Vendure <=3.7) and 2.x (3.8+)
// are used; pills, selects and segmented controls are plain elements.

export type ScheduleStatus = 'PENDING' | 'PROCESSING' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type ScheduleRow = {
    id: string;
    productId: string;
    product?: { id: string; name: string; enabled: boolean } | null;
    name?: string | null;
    description?: string | null;
    action: 'ENABLE' | 'DISABLE';
    scheduledAt: string;
    endAt?: string | null;
    endAction?: 'ENABLE' | 'DISABLE' | 'RESTORE' | null;
    timezone: string;
    localScheduledAt: string;
    localEndAt?: string | null;
    status: ScheduleStatus;
    nextStep?: 'START' | 'END' | null;
    nextRunAt?: string | null;
    attempts: number;
    lastExecutedAt?: string | null;
    lastError?: string | null;
};

export const UPDATE_PERMISSIONS = ['UpdateCatalog', 'UpdateProduct'];

export function cx(...classes: Array<string | false | null | undefined>) {
    return classes.filter(Boolean).join(' ');
}

export function errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/^\[GraphQL\]\s*/, '');
}

export function isForbidden(error: unknown) {
    return /not currently authorized|FORBIDDEN/i.test(errorMessage(error));
}

/** Whether the administrator may change schedules in the active channel. */
export function useCanUpdate(): boolean {
    const { channels } = useAuth();
    const { activeChannel } = useChannel();
    const permissions = (channels?.find(c => c.id === activeChannel?.id)?.permissions ?? []) as string[];
    return permissions.includes('SuperAdmin') || UPDATE_PERMISSIONS.some(p => permissions.includes(p));
}

export function browserTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

let zoneCache: string[] | undefined;
export function allTimeZones(): string[] {
    if (!zoneCache) {
        try {
            zoneCache = (Intl as any).supportedValuesOf('timeZone') as string[];
        } catch {
            zoneCache = [];
        }
        if (!zoneCache.includes('UTC')) {
            zoneCache = ['UTC', ...zoneCache];
        }
    }
    return zoneCache;
}

/** "Thu, 26 Nov, 09:00" in the given zone (with the year when it isn't the current one). */
export function formatInstant(iso: string | null | undefined, timeZone: string): string {
    if (!iso) {
        return '—';
    }
    try {
        const date = new Date(iso);
        const sameYear = date.getFullYear() === new Date().getFullYear();
        return new Intl.DateTimeFormat(undefined, {
            timeZone,
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: sameYear ? undefined : 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        }).format(date);
    } catch {
        return iso;
    }
}

/** "2026-11-26 08:00 UTC" */
export function formatUtc(iso: string | null | undefined): string {
    return iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '—';
}

/** "in 3 days", "5 minutes ago" */
export function relativeTime(iso: string | null | undefined): string {
    if (!iso) {
        return '';
    }
    const diff = new Date(iso).getTime() - Date.now();
    const abs = Math.abs(diff);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
        ['day', 86_400_000],
        ['hour', 3_600_000],
        ['minute', 60_000],
    ];
    for (const [unit, ms] of units) {
        if (abs >= ms || unit === 'minute') {
            return rtf.format(Math.round(diff / ms), unit);
        }
    }
    return '';
}

const STATUS_META: Record<ScheduleStatus, { label: string; className: string; dot: string }> = {
    PENDING: { label: 'Scheduled', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400', dot: 'bg-blue-500' },
    PROCESSING: { label: 'Running', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', dot: 'bg-amber-500 animate-pulse' },
    ACTIVE: { label: 'Active', className: 'bg-success/10 text-success', dot: 'bg-success' },
    COMPLETED: { label: 'Completed', className: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/60' },
    FAILED: { label: 'Failed', className: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
    CANCELLED: { label: 'Cancelled', className: 'bg-muted text-muted-foreground line-through decoration-1', dot: 'bg-muted-foreground/40' },
};

export const ALL_STATUSES = Object.keys(STATUS_META) as ScheduleStatus[];

export function statusLabel(status: ScheduleStatus) {
    return STATUS_META[status]?.label ?? status;
}

export function StatusPill({ status }: { status: ScheduleStatus }) {
    const meta = STATUS_META[status];
    return (
        <span
            className={cx(
                'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium',
                meta?.className,
            )}
        >
            <span className={cx('h-1.5 w-1.5 rounded-full', meta?.dot)} />
            {meta?.label ?? status}
        </span>
    );
}

export function actionLabel(action: string): string {
    return action === 'ENABLE' ? 'Enable' : action === 'DISABLE' ? 'Disable' : action === 'RESTORE' ? 'Restore' : action;
}

export function Callout({ tone, children }: { tone: 'warning' | 'info' | 'error'; children: ReactNode }) {
    return (
        <div
            role={tone === 'error' ? 'alert' : 'note'}
            className={cx(
                'flex gap-2 rounded-lg border p-3 text-xs',
                tone === 'warning' && 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
                tone === 'info' && 'bg-muted/50 text-muted-foreground',
                tone === 'error' && 'border-destructive/30 bg-destructive/5 text-destructive',
            )}
        >
            {tone === 'info' ? (
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <div className="space-y-1">{children}</div>
        </div>
    );
}

/** Warns when no scheduler strategy is configured: schedules would never run. */
export function SchedulerStatusBanner() {
    const { data } = useQuery({
        queryKey: ['productLaunchSchedulerStatus'],
        queryFn: () => api.query(productLaunchSchedulerStatusQuery),
        staleTime: 60_000,
    });
    if (!data || data.productLaunchSchedulerStatus.schedulerRunning) {
        return null;
    }
    return (
        <Callout tone="error">
            <strong>Schedules are not running.</strong> No scheduler is configured on the server. Add{' '}
            <code>DefaultSchedulerPlugin.init()</code> to the Vendure plugins and restart.
        </Callout>
    );
}

/** Builds a plain-language summary: "Enable, then restore". */
export function describeSchedule(row: Pick<ScheduleRow, 'action' | 'endAction' | 'endAt'>): string {
    const start = actionLabel(row.action);
    if (!row.endAt) {
        return start;
    }
    const end = row.endAction === 'RESTORE' ? 'restore' : (row.endAction ?? 'DISABLE').toLowerCase();
    return `${start}, then ${end}`;
}
