import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    api,
    Button,
    DashboardRouteDefinition,
    FullWidthPageBlock,
    Link,
    Page,
    PageLayout,
    PageTitle,
    Skeleton,
} from '@vendure/dashboard';
import { CalendarClock, ChevronDown, ChevronRight, Loader2, RotateCcw, X } from 'lucide-react';
import { Fragment, useState } from 'react';
import { toast } from 'sonner';

import {
    cancelProductLaunchScheduleMutation,
    productLaunchScheduleExecutionsQuery,
    productLaunchSchedulesQuery,
    retryProductLaunchScheduleMutation,
} from './launch-schedules.graphql';
import {
    actionLabel,
    ALL_STATUSES,
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
    type ScheduleStatus,
    statusLabel,
    StatusPill,
    useCanUpdate,
} from './shared';

const PAGE_SIZE = 20;
const DEFAULT_STATUSES: ScheduleStatus[] = ['PENDING', 'PROCESSING', 'ACTIVE', 'FAILED'];

export const launchSchedulesRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'catalog',
        id: 'launch-schedules',
        url: '/launch-schedules',
        title: 'Launch schedules',
        requiresPermission: ['ReadCatalog', 'ReadProduct'],
    },
    path: '/launch-schedules',
    loader: () => ({ breadcrumb: 'Launch schedules' }),
    component: () => <LaunchSchedulesPage />,
};

function initialProductId(): string | undefined {
    try {
        return new URLSearchParams(window.location.search).get('productId') ?? undefined;
    } catch {
        return undefined;
    }
}

function LaunchSchedulesPage() {
    const queryClient = useQueryClient();
    const canUpdate = useCanUpdate();
    const [statuses, setStatuses] = useState<ScheduleStatus[]>(DEFAULT_STATUSES);
    const [productId, setProductId] = useState<string | undefined>(initialProductId);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [page, setPage] = useState(0);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

    const options = {
        status: statuses.length ? statuses : undefined,
        productId,
        from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
        sortBy: 'scheduledAt' as const,
        sortOrder: 'ASC' as const,
    };
    const { data, isLoading, error, isFetching } = useQuery({
        queryKey: ['productLaunchSchedules', 'list', options],
        queryFn: () => api.query(productLaunchSchedulesQuery, { options }),
        placeholderData: previous => previous,
    });

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['productLaunchSchedules'] });
    const cancel = useMutation({
        mutationFn: (id: string) => api.mutate(cancelProductLaunchScheduleMutation, { id }),
        onSuccess: () => {
            toast.success('Schedule cancelled');
            setConfirmCancel(null);
            void refresh();
        },
        onError: err => toast.error('Could not cancel the schedule', { description: errorMessage(err) }),
    });
    const retry = useMutation({
        mutationFn: (id: string) => api.mutate(retryProductLaunchScheduleMutation, { id }),
        onSuccess: () => {
            toast.success('The step will run again within a minute');
            void refresh();
        },
        onError: err => toast.error('Could not retry', { description: errorMessage(err) }),
    });

    const toggleStatus = (status: ScheduleStatus) => {
        setPage(0);
        setStatuses(current => (current.includes(status) ? current.filter(s => s !== status) : [...current, status]));
    };

    const rows = (data?.productLaunchSchedules.items ?? []) as ScheduleRow[];
    const total = data?.productLaunchSchedules.totalItems ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <Page pageId="launch-schedules">
            <PageTitle>Launch schedules</PageTitle>
            <PageLayout>
                <FullWidthPageBlock blockId="launch-schedules-list">
                    <div className="space-y-4">
                        <SchedulerStatusBanner />
                        <p className="text-sm text-muted-foreground">
                            Scheduled changes of products' global Enabled setting. They apply to every channel.
                            Schedules are created on the product page.
                        </p>

                        <div className="flex flex-wrap items-end gap-3">
                            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
                                {ALL_STATUSES.map(status => {
                                    const active = statuses.includes(status);
                                    return (
                                        <button
                                            key={status}
                                            type="button"
                                            aria-pressed={active}
                                            onClick={() => toggleStatus(status)}
                                            className={cx(
                                                'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                                                active ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                                            )}
                                        >
                                            {statusLabel(status)}
                                        </button>
                                    );
                                })}
                            </div>
                            <label className="text-xs text-muted-foreground">
                                From
                                <input
                                    type="date"
                                    value={from}
                                    onChange={e => {
                                        setFrom(e.target.value);
                                        setPage(0);
                                    }}
                                    className="ml-1 h-8 rounded-md border border-input bg-background px-2 text-xs"
                                />
                            </label>
                            <label className="text-xs text-muted-foreground">
                                To
                                <input
                                    type="date"
                                    value={to}
                                    onChange={e => {
                                        setTo(e.target.value);
                                        setPage(0);
                                    }}
                                    className="ml-1 h-8 rounded-md border border-input bg-background px-2 text-xs"
                                />
                            </label>
                            {productId && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setProductId(undefined);
                                        setPage(0);
                                    }}
                                    className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
                                    title="Show all products"
                                >
                                    Product {rows[0]?.product?.name ?? productId}
                                    <X className="h-3 w-3" />
                                </button>
                            )}
                            {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                        </div>

                        {isLoading ? (
                            <div className="space-y-2" aria-busy="true">
                                {[0, 1, 2].map(i => (
                                    <Skeleton key={i} className="h-12 w-full" />
                                ))}
                            </div>
                        ) : error ? (
                            <Callout tone="error">
                                {isForbidden(error)
                                    ? 'You do not have permission to view launch schedules.'
                                    : `Could not load launch schedules. ${errorMessage(error)}`}
                            </Callout>
                        ) : rows.length === 0 ? (
                            <div className="rounded-lg border border-dashed p-8 text-center">
                                <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground/60" />
                                <p className="mt-2 text-sm font-medium">No schedules match these filters</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Open a product and use “Schedule a change” in the Launch schedule panel.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto rounded-lg border">
                                <table className="w-full text-sm">
                                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                                        <tr>
                                            <th className="w-8 px-2 py-2" />
                                            <th className="px-3 py-2 font-medium">Product</th>
                                            <th className="px-3 py-2 font-medium">Change</th>
                                            <th className="px-3 py-2 font-medium">Start</th>
                                            <th className="px-3 py-2 font-medium">End</th>
                                            <th className="px-3 py-2 font-medium">Status</th>
                                            <th className="px-3 py-2 font-medium">Last result</th>
                                            <th className="px-3 py-2" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map(row => (
                                            <Fragment key={row.id}>
                                                <tr className="border-t align-top">
                                                    <td className="px-2 py-2">
                                                        <button
                                                            type="button"
                                                            aria-label={expanded === row.id ? 'Hide history' : 'Show history'}
                                                            aria-expanded={expanded === row.id}
                                                            onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                                                            className="rounded p-1 text-muted-foreground hover:bg-muted"
                                                        >
                                                            {expanded === row.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                        </button>
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        {row.product ? (
                                                            <Link to={`/products/${row.product.id}`} className="font-medium hover:underline">
                                                                {row.product.name}
                                                            </Link>
                                                        ) : (
                                                            <span className="text-muted-foreground">Product {row.productId}</span>
                                                        )}
                                                        {row.name && <p className="text-xs text-muted-foreground">{row.name}</p>}
                                                    </td>
                                                    <td className="px-3 py-2 whitespace-nowrap">{describeSchedule(row)}</td>
                                                    <td className="px-3 py-2">
                                                        <TimeCell iso={row.scheduledAt} timezone={row.timezone} />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        {row.endAt ? <TimeCell iso={row.endAt} timezone={row.timezone} /> : <span className="text-muted-foreground">—</span>}
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <StatusPill status={row.status} />
                                                        {row.nextRunAt && (row.status === 'PENDING' || row.status === 'ACTIVE') && (
                                                            <p className="mt-1 text-[11px] text-muted-foreground">
                                                                {row.nextStep === 'END' ? 'ends' : 'starts'} {relativeTime(row.nextRunAt)}
                                                            </p>
                                                        )}
                                                    </td>
                                                    <td className="max-w-[16rem] px-3 py-2 text-xs">
                                                        {row.lastError ? (
                                                            <span className={row.status === 'FAILED' ? 'text-destructive' : 'text-amber-600'}>{row.lastError}</span>
                                                        ) : row.lastExecutedAt ? (
                                                            <span className="text-muted-foreground">Ran {relativeTime(row.lastExecutedAt)}</span>
                                                        ) : (
                                                            <span className="text-muted-foreground">—</span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 text-right whitespace-nowrap">
                                                        {canUpdate && confirmCancel === row.id ? (
                                                            <span className="inline-flex items-center gap-1">
                                                                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmCancel(null)}>
                                                                    Keep
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    variant="destructive"
                                                                    size="sm"
                                                                    disabled={cancel.isPending}
                                                                    onClick={() => cancel.mutate(row.id)}
                                                                >
                                                                    Cancel schedule
                                                                </Button>
                                                            </span>
                                                        ) : canUpdate ? (
                                                            <span className="inline-flex items-center gap-1">
                                                                {row.status === 'FAILED' && (
                                                                    <Button type="button" variant="outline" size="sm" disabled={retry.isPending} onClick={() => retry.mutate(row.id)}>
                                                                        <RotateCcw className="mr-1 h-3 w-3" /> Retry
                                                                    </Button>
                                                                )}
                                                                {(row.status === 'PENDING' || row.status === 'ACTIVE') && (
                                                                    <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmCancel(row.id)}>
                                                                        Cancel
                                                                    </Button>
                                                                )}
                                                            </span>
                                                        ) : null}
                                                    </td>
                                                </tr>
                                                {expanded === row.id && (
                                                    <tr className="border-t bg-muted/20">
                                                        <td />
                                                        <td colSpan={7} className="px-3 py-3">
                                                            <ExecutionHistory scheduleId={row.id} />
                                                        </td>
                                                    </tr>
                                                )}
                                            </Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {total > PAGE_SIZE && (
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>
                                    {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total}
                                </span>
                                <span className="flex gap-1">
                                    <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                                        Previous
                                    </Button>
                                    <Button type="button" variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage(p => p + 1)}>
                                        Next
                                    </Button>
                                </span>
                            </div>
                        )}
                    </div>
                </FullWidthPageBlock>
            </PageLayout>
        </Page>
    );
}

function TimeCell({ iso, timezone }: { iso: string; timezone: string }) {
    return (
        <div className="whitespace-nowrap">
            <span>{formatInstant(iso, timezone)}</span>
            <p className="text-[11px] text-muted-foreground">
                {timezone} · {formatUtc(iso)}
            </p>
        </div>
    );
}

const OUTCOME_CLASS: Record<string, string> = {
    SUCCEEDED: 'text-success',
    NO_CHANGE: 'text-muted-foreground',
    SKIPPED: 'text-amber-600',
    FAILED: 'text-destructive',
};

function ExecutionHistory({ scheduleId }: { scheduleId: string }) {
    const { data, isLoading, error } = useQuery({
        queryKey: ['productLaunchSchedules', 'executions', scheduleId],
        queryFn: () => api.query(productLaunchScheduleExecutionsQuery, { scheduleId }),
    });
    if (isLoading) {
        return <Skeleton className="h-8 w-full" />;
    }
    if (error) {
        return <p className="text-xs text-destructive">Could not load the history. {errorMessage(error)}</p>;
    }
    const items = data?.productLaunchScheduleExecutions.items ?? [];
    if (!items.length) {
        return <p className="text-xs text-muted-foreground">Nothing has run yet.</p>;
    }
    return (
        <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
                <tr>
                    <th className="py-1 pr-3 font-medium">Ran at</th>
                    <th className="py-1 pr-3 font-medium">Step</th>
                    <th className="py-1 pr-3 font-medium">Outcome</th>
                    <th className="py-1 pr-3 font-medium">Enabled</th>
                    <th className="py-1 pr-3 font-medium">Attempt</th>
                    <th className="py-1 font-medium">Details</th>
                </tr>
            </thead>
            <tbody>
                {items.map((e: any) => (
                    <tr key={e.id} className="border-t border-border/50">
                        <td className="py-1 pr-3 whitespace-nowrap">
                            {formatUtc(e.executedAt)}
                            {e.ranLateBySeconds > 90 && <span className="ml-1 text-amber-600">({Math.round(e.ranLateBySeconds / 60)} min late)</span>}
                        </td>
                        <td className="py-1 pr-3">
                            {e.step === 'START' ? 'Start' : 'End'} · {actionLabel(e.action)}
                        </td>
                        <td className={cx('py-1 pr-3 font-medium', OUTCOME_CLASS[e.outcome])}>{e.outcome.replace('_', ' ').toLowerCase()}</td>
                        <td className="py-1 pr-3 whitespace-nowrap">
                            {e.enabledBefore === null ? '—' : `${e.enabledBefore ? 'on' : 'off'} → ${e.enabledAfter ? 'on' : 'off'}`}
                        </td>
                        <td className="py-1 pr-3">{e.attempt}</td>
                        <td className="py-1 text-muted-foreground">{e.message ?? ''}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
