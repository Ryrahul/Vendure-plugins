import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ChannelCodeLabel, Skeleton, useAuth, useChannel } from '@vendure/dashboard';
import { AlertTriangle, Eye, EyeOff, Globe, Info, Loader2, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';

import {
    clearProductChannelAvailabilityMutation,
    productChannelAvailabilitiesQuery,
    setProductChannelAvailabilityMutation,
} from './channel-availability.graphql';

// Only primitives whose API is identical in @vendure-io/ui 1.x (Vendure <=3.7) and
// 2.x (3.8+) are used; status pills and the segmented control are plain elements.

const UPDATE_PERMISSIONS = ['UpdateCatalog', 'UpdateProduct'];

type OverrideState = 'INHERITED' | 'ENABLED' | 'DISABLED';

type Row = {
    channelId: string;
    channelCode: string;
    globalEnabled: boolean;
    override: boolean | null;
    overrideState: OverrideState;
    effectiveEnabled: boolean;
};

type Change = { channelId: string; channelCode: string; next: OverrideState };

function cx(...classes: Array<string | false | null | undefined>) {
    return classes.filter(Boolean).join(' ');
}

function isForbidden(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /not currently authorized|FORBIDDEN/i.test(message);
}

function applyChange(row: Row, next: OverrideState): Row {
    const override = next === 'INHERITED' ? null : next === 'ENABLED';
    return {
        ...row,
        override,
        overrideState: next,
        effectiveEnabled: override ?? row.globalEnabled,
    };
}

/**
 * Per-channel availability of the product on the product detail page.
 *
 * Each control only changes the override for that one channel; the product's
 * global "Enabled" switch is never modified here.
 */
export function ChannelAvailabilityBlock({
    productId,
    productName,
    globalEnabledHint,
}: {
    productId: string;
    productName?: string;
    /** The product's saved `enabled` value; refetches when it changes. */
    globalEnabledHint?: boolean;
}) {
    const queryClient = useQueryClient();
    const { channels } = useAuth();
    const { activeChannel } = useChannel();
    const queryKey = ['productChannelAvailabilities', productId, globalEnabledHint];

    const { data, isLoading, error } = useQuery({
        queryKey,
        queryFn: () => api.query(productChannelAvailabilitiesQuery, { productId }),
    });

    const mutation = useMutation<unknown, unknown, Change, { previous: unknown }>({
        mutationFn: ({ channelId, next }: Change): Promise<unknown> =>
            next === 'INHERITED'
                ? api.mutate(clearProductChannelAvailabilityMutation, { input: { productId, channelId } })
                : api.mutate(setProductChannelAvailabilityMutation, {
                      input: { productId, channelId, enabled: next === 'ENABLED' },
                  }),
        // Optimistic: flip the row immediately, roll back if the server rejects it.
        onMutate: async ({ channelId, next }) => {
            await queryClient.cancelQueries({ queryKey });
            const previous = queryClient.getQueryData<any>(queryKey);
            queryClient.setQueryData<any>(queryKey, (old: any) =>
                old
                    ? {
                          ...old,
                          productChannelAvailabilities: old.productChannelAvailabilities.map((r: Row) =>
                              r.channelId === channelId ? applyChange(r, next) : r,
                          ),
                      }
                    : old,
            );
            return { previous };
        },
        onError: (err, { channelCode }, context) => {
            queryClient.setQueryData(queryKey, context?.previous);
            toast.error(`Could not update ${channelLabel(channelCode)}`, {
                description: isForbidden(err)
                    ? 'You do not have permission to change availability in this channel.'
                    : err instanceof Error
                      ? err.message
                      : 'Unknown error',
            });
        },
        onSuccess: (_result, { channelCode, next }) => {
            const subject = productName ?? 'Product';
            const where = channelLabel(channelCode);
            toast.success(
                next === 'INHERITED'
                    ? `${subject} now follows the global status in ${where}`
                    : `${subject} is now ${next === 'ENABLED' ? 'available' : 'hidden'} in ${where}`,
            );
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: ['productChannelAvailabilities', productId] }),
    });

    const canUpdateIn = (channelId: string) => {
        const permissions = (channels?.find(c => c.id === channelId)?.permissions ?? []) as string[];
        return UPDATE_PERMISSIONS.some(p => permissions.includes(p));
    };

    if (isLoading) {
        return (
            <div className="space-y-3" aria-busy="true" aria-label="Loading channel availability">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-[88px] w-full rounded-lg" />
                <Skeleton className="h-[88px] w-full rounded-lg" />
            </div>
        );
    }

    if (error) {
        const forbidden = isForbidden(error);
        return (
            <div
                role="alert"
                className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
                {forbidden ? <Lock className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                <span>
                    {forbidden
                        ? 'You do not have permission to view channel availability for this product.'
                        : `Could not load channel availability. ${error instanceof Error ? error.message : ''}`}
                </span>
            </div>
        );
    }

    const rows = (data?.productChannelAvailabilities ?? []) as Row[];
    if (!rows.length) {
        return (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                This product is not assigned to any channel you can manage.
            </div>
        );
    }

    const globalEnabled = rows[0].globalEnabled;
    const availableCount = rows.filter(r => r.effectiveEnabled).length;
    const enabledDespiteGlobal = rows.filter(r => !r.globalEnabled && r.overrideState === 'ENABLED');
    const hiddenDespiteGlobal = rows.filter(r => r.globalEnabled && r.overrideState === 'DISABLED');

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <p className="text-sm text-muted-foreground">
                    Available in <span className="font-semibold text-foreground">{availableCount}</span> of{' '}
                    {rows.length} channel{rows.length === 1 ? '' : 's'}
                </p>
                <span
                    className={cx(
                        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium',
                        globalEnabled ? 'border-success/30 text-success' : 'text-muted-foreground',
                    )}
                    title="The product's own Enabled switch. Channels set to Global follow it."
                >
                    <Globe className="h-3 w-3" />
                    Global {globalEnabled ? 'on' : 'off'}
                </span>
            </div>

            {enabledDespiteGlobal.length > 0 && (
                <Callout tone="warning">
                    Disabled globally, but still <strong>sold</strong> in{' '}
                    {joinLabels(enabledDespiteGlobal)} because of a channel override.
                </Callout>
            )}
            {hiddenDespiteGlobal.length > 0 && (
                <Callout tone="info">
                    Enabled globally, but <strong>hidden</strong> in {joinLabels(hiddenDespiteGlobal)}.
                </Callout>
            )}

            <ul className="space-y-2">
                {rows.map(row => (
                    <ChannelRow
                        key={row.channelId}
                        row={row}
                        isActive={row.channelId === activeChannel?.id}
                        canUpdate={canUpdateIn(row.channelId)}
                        pending={mutation.isPending && mutation.variables?.channelId === row.channelId}
                        disabled={mutation.isPending}
                        onChange={next =>
                            next !== row.overrideState &&
                            mutation.mutate({ channelId: row.channelId, channelCode: row.channelCode, next })
                        }
                    />
                ))}
            </ul>
        </div>
    );
}

function ChannelRow({
    row,
    isActive,
    canUpdate,
    pending,
    disabled,
    onChange,
}: {
    row: Row;
    isActive: boolean;
    canUpdate: boolean;
    pending: boolean;
    disabled: boolean;
    onChange: (next: OverrideState) => void;
}) {
    const options: Array<{ value: OverrideState; label: string; hint: string }> = [
        { value: 'INHERITED', label: 'Global', hint: `Follow the global status (${row.globalEnabled ? 'on' : 'off'})` },
        { value: 'ENABLED', label: 'On', hint: 'Always available in this channel' },
        { value: 'DISABLED', label: 'Off', hint: 'Always hidden in this channel' },
    ];
    const description =
        row.overrideState === 'INHERITED'
            ? `Follows global (${row.globalEnabled ? 'on' : 'off'})`
            : row.overrideState === 'ENABLED'
              ? row.globalEnabled
                  ? 'Always on here'
                  : 'On here, despite global off'
              : 'Always off here';

    return (
        <li
            className={cx(
                'rounded-lg border bg-card p-3 transition-colors',
                'border-l-[3px]',
                row.effectiveEnabled ? 'border-l-success' : 'border-l-muted-foreground/30',
            )}
        >
            <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium" title={row.channelCode}>
                    <ChannelCodeLabel code={row.channelCode} />
                </p>
                <StatusPill available={row.effectiveEnabled} pending={pending} />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
                {isActive && <span className="font-medium text-foreground/70">Current · </span>}
                {description}
            </p>

            {canUpdate ? (
                <div
                    role="radiogroup"
                    aria-label={`Availability in ${channelLabel(row.channelCode)}`}
                    className="mt-3 grid grid-cols-3 gap-0.5 rounded-md bg-muted p-0.5"
                >
                    {options.map(option => {
                        const selected = row.overrideState === option.value;
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
                                    'inline-flex items-center justify-center gap-1 rounded-[5px] px-2 py-1 text-xs font-medium transition-all',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    'disabled:cursor-not-allowed',
                                    selected
                                        ? 'bg-background text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground',
                                    disabled && !selected && 'opacity-60',
                                )}
                            >
                                {option.value === 'INHERITED' && <Globe className="h-3 w-3" />}
                                {option.value === 'ENABLED' && <Eye className="h-3 w-3" />}
                                {option.value === 'DISABLED' && <EyeOff className="h-3 w-3" />}
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            ) : (
                <p
                    className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground"
                    title="You need UpdateCatalog or UpdateProduct permission in this channel to change it."
                >
                    <Lock className="h-3 w-3" />
                    View only in this channel
                </p>
            )}
        </li>
    );
}

function StatusPill({ available, pending }: { available: boolean; pending: boolean }) {
    return (
        <span
            className={cx(
                'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                available ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
            )}
        >
            {pending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
                <span className={cx('h-1.5 w-1.5 rounded-full', available ? 'bg-success' : 'bg-muted-foreground/60')} />
            )}
            {available ? 'Available' : 'Hidden'}
        </span>
    );
}

function Callout({ tone, children }: { tone: 'warning' | 'info'; children: ReactNode }) {
    return (
        <div
            className={cx(
                'flex gap-2 rounded-lg border p-2.5 text-xs leading-relaxed',
                tone === 'warning' ? 'border-warning/40 bg-warning/10 text-warning' : 'bg-muted/50 text-muted-foreground',
            )}
        >
            {tone === 'warning' ? (
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            ) : (
                <Info className="mt-px h-3.5 w-3.5 shrink-0" />
            )}
            <span>{children}</span>
        </div>
    );
}

function channelLabel(code: string) {
    return code === '__default_channel__' ? 'Default channel' : code;
}

function joinLabels(rows: Row[]) {
    return rows.map(r => channelLabel(r.channelCode)).join(', ');
}
