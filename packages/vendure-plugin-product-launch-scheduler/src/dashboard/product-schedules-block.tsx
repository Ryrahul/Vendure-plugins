import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Button, Link, Skeleton } from '@vendure/dashboard';
import { CalendarClock, Globe, Loader2, Lock, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
    cancelProductLaunchScheduleMutation,
    productLaunchSchedulesQuery,
    retryProductLaunchScheduleMutation,
} from './launch-schedules.graphql';
import { ScheduleForm } from './schedule-form';
import {
    Callout,
    cx,
    describeSchedule,
    errorMessage,
    formatInstant,
    formatUtc,
    isForbidden,
    relativeTime,
    SchedulerStatusBanner,
    type ScheduleRow,
    StatusPill,
    useCanUpdate,
} from './shared';

/**
 * Launch schedules of the product, on the product detail page: what is planned, what is running,
 * what failed, and a form to schedule a change.
 */
export function ProductSchedulesBlock({
    productId,
    productName,
    globalEnabled,
}: {
    productId: string;
    productName?: string;
    globalEnabled?: boolean;
}) {
    const queryClient = useQueryClient();
    const canUpdate = useCanUpdate();
    const [mode, setMode] = useState<{ kind: 'idle' } | { kind: 'create' } | { kind: 'edit'; schedule: ScheduleRow }>({ kind: 'idle' });
    const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

    const queryKey = ['productLaunchSchedules', 'product', productId];
    const { data, isLoading, error } = useQuery({
        queryKey,
        queryFn: () =>
            api.query(productLaunchSchedulesQuery, {
                options: { productId, status: ['PENDING', 'PROCESSING', 'ACTIVE', 'FAILED'], take: 50 },
            }),
        // refresh while something is due soon or running
        refetchInterval: query => {
            const items = (query.state.data?.productLaunchSchedules.items ?? []) as ScheduleRow[];
            const soon = items.some(
                s => s.status === 'PROCESSING' || (s.nextRunAt && new Date(s.nextRunAt).getTime() - Date.now() < 120_000),
            );
            return soon ? 10_000 : false;
        },
    });

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['productLaunchSchedules'] });

    const cancel = useMutation({
        mutationFn: (id: string) => api.mutate(cancelProductLaunchScheduleMutation, { id }),
        onSuccess: () => {
            toast.success('Schedule cancelled');
            setConfirmCancel(null);
            refresh();
        },
        onError: err => toast.error('Could not cancel the schedule', { description: errorMessage(err) }),
    });

    const retry = useMutation({
        mutationFn: (id: string) => api.mutate(retryProductLaunchScheduleMutation, { id }),
        onSuccess: () => {
            toast.success('The step will run again within a minute');
            refresh();
        },
        onError: err => toast.error('Could not retry', { description: errorMessage(err) }),
    });

    if (isLoading) {
        return (
            <div className="space-y-3" aria-busy="true" aria-label="Loading launch schedules">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-[72px] w-full rounded-lg" />
            </div>
        );
    }

    if (error) {
        return (
            <Callout tone="error">
                {isForbidden(error)
                    ? 'You do not have permission to view launch schedules.'
                    : `Could not load launch schedules. ${errorMessage(error)}`}
            </Callout>
        );
    }

    const schedules = (data?.productLaunchSchedules.items ?? []) as ScheduleRow[];

    return (
        <div className="space-y-3">
            <SchedulerStatusBanner />

            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                    {schedules.length ? (
                        <>
                            <span className="font-semibold text-foreground">{schedules.length}</span> upcoming or active
                        </>
                    ) : (
                        'Nothing scheduled'
                    )}
                </p>
                {globalEnabled !== undefined && (
                    <span
                        className={cx(
                            'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium',
                            globalEnabled ? 'border-success/30 text-success' : 'text-muted-foreground',
                        )}
                        title="The product's global Enabled setting, which schedules change"
                    >
                        <Globe className="h-3 w-3" />
                        Now {globalEnabled ? 'enabled' : 'disabled'}
                    </span>
                )}
            </div>

            {schedules.length > 0 && (
                <ul className="space-y-2">
                    {schedules.map(schedule =>
                        mode.kind === 'edit' && mode.schedule.id === schedule.id ? (
                            <li key={schedule.id}>
                                <ScheduleForm
                                    productId={productId}
                                    productName={productName}
                                    schedule={schedule}
                                    onDone={() => setMode({ kind: 'idle' })}
                                    onCancel={() => setMode({ kind: 'idle' })}
                                />
                            </li>
                        ) : (
                            <ScheduleCard
                                key={schedule.id}
                                schedule={schedule}
                                canUpdate={canUpdate}
                                busy={cancel.isPending || retry.isPending}
                                confirmingCancel={confirmCancel === schedule.id}
                                onEdit={() => setMode({ kind: 'edit', schedule })}
                                onCancel={() => setConfirmCancel(schedule.id)}
                                onConfirmCancel={() => cancel.mutate(schedule.id)}
                                onAbortCancel={() => setConfirmCancel(null)}
                                onRetry={() => retry.mutate(schedule.id)}
                            />
                        ),
                    )}
                </ul>
            )}

            {mode.kind === 'create' ? (
                <ScheduleForm
                    productId={productId}
                    productName={productName}
                    onDone={() => setMode({ kind: 'idle' })}
                    onCancel={() => setMode({ kind: 'idle' })}
                />
            ) : canUpdate ? (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setMode({ kind: 'create' })}
                    disabled={mode.kind === 'edit'}
                >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Schedule a change
                </Button>
            ) : (
                <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="h-3 w-3" />
                    You need UpdateCatalog or UpdateProduct permission to schedule changes.
                </p>
            )}

            <Link
                to="/launch-schedules"
                search={{ productId }}
                className="block text-center text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
                History and all schedules
            </Link>
        </div>
    );
}

function ScheduleCard({
    schedule,
    canUpdate,
    busy,
    confirmingCancel,
    onEdit,
    onCancel,
    onConfirmCancel,
    onAbortCancel,
    onRetry,
}: {
    schedule: ScheduleRow;
    canUpdate: boolean;
    busy: boolean;
    confirmingCancel: boolean;
    onEdit: () => void;
    onCancel: () => void;
    onConfirmCancel: () => void;
    onAbortCancel: () => void;
    onRetry: () => void;
}) {
    const nextIsEnd = schedule.nextStep === 'END';
    const editable = schedule.status === 'PENDING' || schedule.status === 'ACTIVE';
    return (
        <li
            className={cx(
                'rounded-lg border border-l-[3px] bg-card p-3',
                schedule.status === 'FAILED' ? 'border-l-destructive' : schedule.status === 'ACTIVE' ? 'border-l-success' : 'border-l-blue-500',
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="break-words text-sm font-medium">{schedule.name || describeSchedule(schedule)}</p>
                    {schedule.name && <p className="text-xs text-muted-foreground">{describeSchedule(schedule)}</p>}
                </div>
                <StatusPill status={schedule.status} />
            </div>

            <dl className="mt-2 space-y-1 text-xs">
                <TimeLine
                    label={schedule.action === 'ENABLE' ? 'Enable' : 'Disable'}
                    iso={schedule.scheduledAt}
                    timezone={schedule.timezone}
                    done={schedule.status === 'ACTIVE' || (schedule.status === 'FAILED' && nextIsEnd)}
                />
                {schedule.endAt && (
                    <TimeLine
                        label={schedule.endAction === 'RESTORE' ? 'Restore' : schedule.endAction === 'ENABLE' ? 'Enable' : 'Disable'}
                        iso={schedule.endAt}
                        timezone={schedule.timezone}
                    />
                )}
            </dl>

            {schedule.status === 'FAILED' && schedule.lastError && (
                <p className="mt-2 rounded bg-destructive/5 p-2 text-xs text-destructive">{schedule.lastError}</p>
            )}
            {schedule.status !== 'FAILED' && schedule.attempts > 0 && schedule.lastError && (
                <p className="mt-2 text-xs text-amber-600">
                    Retrying {relativeTime(schedule.nextRunAt)} after: {schedule.lastError}
                </p>
            )}

            {canUpdate && (
                <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
                    {confirmingCancel ? (
                        <>
                            <span className="mr-auto text-xs text-muted-foreground">
                                {schedule.status === 'ACTIVE' ? 'Cancel? The end step will not run.' : 'Cancel this schedule?'}
                            </span>
                            <Button type="button" variant="ghost" size="sm" onClick={onAbortCancel} disabled={busy}>
                                Keep
                            </Button>
                            <Button type="button" variant="destructive" size="sm" onClick={onConfirmCancel} disabled={busy}>
                                {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                                Cancel schedule
                            </Button>
                        </>
                    ) : (
                        <>
                            {schedule.status === 'FAILED' && (
                                <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={busy}>
                                    <RotateCcw className="mr-1 h-3 w-3" /> Retry
                                </Button>
                            )}
                            {editable && (
                                <>
                                    <Button type="button" variant="ghost" size="sm" onClick={onEdit} disabled={busy}>
                                        <Pencil className="mr-1 h-3 w-3" /> Edit
                                    </Button>
                                    <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
                                        <X className="mr-1 h-3 w-3" /> Cancel
                                    </Button>
                                </>
                            )}
                        </>
                    )}
                </div>
            )}
        </li>
    );
}

function TimeLine({ label, iso, timezone, done }: { label: string; iso: string; timezone: string; done?: boolean }) {
    return (
        <div className={cx('flex gap-2', done && 'text-muted-foreground')}>
            <dt className="w-16 shrink-0 text-muted-foreground">
                <CalendarClock className="mr-1 inline h-3 w-3" />
                {label}
            </dt>
            <dd className="min-w-0">
                <span className={cx('font-medium', done ? 'line-through decoration-1' : 'text-foreground/90')}>
                    {formatInstant(iso, timezone)}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                    {timezone} · {formatUtc(iso)}
                    {done ? ' · done' : ` · ${relativeTime(iso)}`}
                </span>
            </dd>
        </div>
    );
}
