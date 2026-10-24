import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Button, Input } from '@vendure/dashboard';
import { Eye, EyeOff, Globe, Loader2 } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
    createProductLaunchScheduleMutation,
    productLaunchTimePreviewQuery,
    updateProductLaunchScheduleMutation,
} from './launch-schedules.graphql';
import { allTimeZones, browserTimeZone, Callout, cx, errorMessage, formatUtc, type ScheduleRow } from './shared';

type Action = 'ENABLE' | 'DISABLE';
type EndAction = 'ENABLE' | 'DISABLE' | 'RESTORE';

const inputClass =
    'h-8 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60';

/** Defaults to the next full hour, as YYYY-MM-DDTHH:mm in the browser's zone. */
function nextFullHourLocal(hoursAhead = 1): string {
    const date = new Date();
    date.setMinutes(0, 0, 0);
    date.setHours(date.getHours() + hoursAhead);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Shows what a local time is in UTC, or why it is invalid (DST gap, bad zone). */
function TimePreview({
    localTime,
    timezone,
    onUseSuggestion,
}: {
    localTime: string;
    timezone: string;
    onUseSuggestion: (value: string) => void;
}) {
    const [debounced, setDebounced] = useState({ localTime, timezone });
    useEffect(() => {
        const timer = setTimeout(() => setDebounced({ localTime, timezone }), 250);
        return () => clearTimeout(timer);
    }, [localTime, timezone]);

    const { data, isFetching } = useQuery({
        queryKey: ['productLaunchTimePreview', debounced.localTime, debounced.timezone],
        queryFn: () => api.query(productLaunchTimePreviewQuery, debounced),
        enabled: !!debounced.localTime && !!debounced.timezone,
        staleTime: Infinity,
    });
    const preview = data?.productLaunchTimePreview;
    if (!localTime) {
        return null;
    }
    if (!preview || isFetching) {
        return <p className="mt-1 h-4 text-[11px] text-muted-foreground">…</p>;
    }
    if (!preview.valid) {
        return (
            <p className="mt-1 text-[11px] text-destructive">
                {preview.errorCode === 'INVALID_LOCAL_TIME' ? (
                    <>
                        This time doesn't exist in {timezone} (clocks skip it for daylight saving time).{' '}
                        {preview.nextValidLocalTime && (
                            <button
                                type="button"
                                className="font-medium underline underline-offset-2"
                                onClick={() => onUseSuggestion(preview.nextValidLocalTime!)}
                            >
                                Use {preview.nextValidLocalTime.replace('T', ' ')}
                            </button>
                        )}
                    </>
                ) : preview.errorCode === 'INVALID_TIMEZONE' ? (
                    'Unknown time zone.'
                ) : (
                    'Invalid date or time.'
                )}
            </p>
        );
    }
    return (
        <p className="mt-1 text-[11px] text-muted-foreground">
            = {formatUtc(preview.instant as string)}
            {preview.ambiguous && ' · this time happens twice (DST), the first one is used'}
        </p>
    );
}

function Segmented<T extends string>({
    value,
    options,
    onChange,
    disabled,
    label,
}: {
    value: T;
    options: Array<{ value: T; label: string; icon?: React.ReactNode; hint?: string }>;
    onChange: (value: T) => void;
    disabled?: boolean;
    label: string;
}) {
    return (
        <div
            role="radiogroup"
            aria-label={label}
            className={cx('grid gap-0.5 rounded-md bg-muted p-0.5', options.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}
        >
            {options.map(option => {
                const selected = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        title={option.hint}
                        disabled={disabled}
                        onClick={() => onChange(option.value)}
                        className={cx(
                            'inline-flex items-center justify-center gap-1 rounded-[5px] px-2 py-1.5 text-xs font-medium transition-all',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed',
                            selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                            disabled && !selected && 'opacity-50',
                        )}
                    >
                        {option.icon}
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

/**
 * Creates a schedule for a product, or edits one. A started (ACTIVE) schedule can only change
 * its end, so the start fields are locked.
 */
export function ScheduleForm({
    productId,
    productName,
    schedule,
    onDone,
    onCancel,
}: {
    productId: string;
    productName?: string;
    schedule?: ScheduleRow;
    onDone: () => void;
    onCancel: () => void;
}) {
    const id = useId();
    const queryClient = useQueryClient();
    const editing = !!schedule;
    const startLocked = schedule?.status === 'ACTIVE';

    const [action, setAction] = useState<Action>(schedule?.action ?? 'ENABLE');
    const [timezone, setTimezone] = useState(schedule?.timezone ?? browserTimeZone());
    const [start, setStart] = useState(schedule?.localScheduledAt ?? nextFullHourLocal());
    const [hasEnd, setHasEnd] = useState(!!schedule?.localEndAt);
    const [end, setEnd] = useState(schedule?.localEndAt ?? nextFullHourLocal(25));
    const [endAction, setEndAction] = useState<EndAction>(schedule?.endAction ?? 'RESTORE');
    const [name, setName] = useState(schedule?.name ?? '');
    const [acknowledged, setAcknowledged] = useState(editing);
    const zones = useMemo(() => allTimeZones(), []);

    const mutation = useMutation({
        mutationFn: async () => {
            if (editing) {
                return api.mutate(updateProductLaunchScheduleMutation, {
                    input: {
                        id: schedule!.id,
                        name: name || null,
                        ...(startLocked ? {} : { action, scheduledAt: start, timezone }),
                        ...(hasEnd ? { endAt: end, endAction } : { removeEnd: true }),
                    },
                });
            }
            return api.mutate(createProductLaunchScheduleMutation, {
                input: {
                    productId,
                    name: name || undefined,
                    action,
                    scheduledAt: start,
                    timezone,
                    ...(hasEnd ? { endAt: end, endAction } : {}),
                },
            });
        },
        onSuccess: () => {
            toast.success(editing ? 'Schedule updated' : `${productName ?? 'Product'} scheduled`);
            void queryClient.invalidateQueries({ queryKey: ['productLaunchSchedules'] });
            onDone();
        },
        onError: err => {
            toast.error(editing ? 'Could not update the schedule' : 'Could not create the schedule', {
                description: errorMessage(err),
            });
        },
    });

    const canSubmit = !!start && !!timezone && (!hasEnd || !!end) && acknowledged && !mutation.isPending;

    // Not a <form>: on the product page this sits inside the page's own form, and a nested form's
    // submit would bubble to it.
    return (
        <div role="form" aria-label={editing ? 'Edit launch schedule' : 'New launch schedule'} className="min-w-0 space-y-4 rounded-lg border bg-card p-3">
            <div className="space-y-1.5">
                <span className="text-xs font-medium">At the start</span>
                <Segmented<Action>
                    label="Start action"
                    value={action}
                    onChange={setAction}
                    disabled={startLocked}
                    options={[
                        { value: 'ENABLE', label: 'Enable', icon: <Eye className="h-3 w-3" />, hint: 'Make the product available' },
                        { value: 'DISABLE', label: 'Disable', icon: <EyeOff className="h-3 w-3" />, hint: 'Hide the product' },
                    ]}
                />
            </div>

            <div className="grid min-w-0 gap-3">
                <div className="min-w-0">
                    <label htmlFor={`${id}-start`} className="text-xs font-medium">
                        Start
                    </label>
                    <input
                        id={`${id}-start`}
                        type="datetime-local"
                        className={cx(inputClass, 'mt-1')}
                        value={start}
                        disabled={startLocked}
                        onChange={e => setStart(e.target.value)}
                        required
                    />
                    {!startLocked && <TimePreview localTime={start} timezone={timezone} onUseSuggestion={setStart} />}
                </div>
                <div className="min-w-0">
                    <label htmlFor={`${id}-tz`} className="flex items-center gap-1 text-xs font-medium">
                        <Globe className="h-3 w-3" /> Time zone
                    </label>
                    <select
                        id={`${id}-tz`}
                        className={cx(inputClass, 'mt-1')}
                        value={timezone}
                        disabled={startLocked}
                        onChange={e => setTimezone(e.target.value)}
                    >
                        {(zones.includes(timezone) ? zones : [timezone, ...zones]).map(zone => (
                            <option key={zone} value={zone}>
                                {zone}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="space-y-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                    <input type="checkbox" checked={hasEnd} onChange={e => setHasEnd(e.target.checked)} className="h-3.5 w-3.5" />
                    End at a later time
                </label>
                {hasEnd && (
                    <div className="min-w-0 space-y-3 border-l-2 pl-2">
                        <div className="min-w-0">
                            <label htmlFor={`${id}-end`} className="text-xs font-medium">
                                End
                            </label>
                            <input
                                id={`${id}-end`}
                                type="datetime-local"
                                className={cx(inputClass, 'mt-1')}
                                value={end}
                                min={start}
                                onChange={e => setEnd(e.target.value)}
                                required
                            />
                            <TimePreview localTime={end} timezone={timezone} onUseSuggestion={setEnd} />
                        </div>
                        <div className="space-y-1.5">
                            <span className="text-xs font-medium">At the end</span>
                            <Segmented<EndAction>
                                label="End action"
                                value={endAction}
                                onChange={setEndAction}
                                options={[
                                    { value: 'RESTORE', label: 'Restore', hint: 'Put back the state from before the start (skipped if someone changed the product manually)' },
                                    { value: 'DISABLE', label: 'Disable', hint: 'Hide the product' },
                                    { value: 'ENABLE', label: 'Enable', hint: 'Make the product available' },
                                ]}
                            />
                        </div>
                    </div>
                )}
            </div>

            <div>
                <label htmlFor={`${id}-name`} className="text-xs font-medium">
                    Name <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Input
                    id={`${id}-name`}
                    className="mt-1"
                    value={name}
                    placeholder="e.g. Black Friday launch"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                />
            </div>

            {!editing && (
                <Callout tone="warning">
                    <p>
                        This changes the product's <strong>global</strong> Enabled setting, so it applies to{' '}
                        <strong>every channel</strong>.
                    </p>
                    <label className="flex cursor-pointer items-center gap-2 font-medium">
                        <input
                            type="checkbox"
                            checked={acknowledged}
                            onChange={e => setAcknowledged(e.target.checked)}
                            className="h-3.5 w-3.5"
                        />
                        I understand
                    </label>
                </Callout>
            )}

            <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={mutation.isPending}>
                    Cancel
                </Button>
                <Button type="button" size="sm" disabled={!canSubmit} onClick={() => mutation.mutate()}>
                    {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                    {editing ? 'Save changes' : 'Schedule'}
                </Button>
            </div>
        </div>
    );
}
