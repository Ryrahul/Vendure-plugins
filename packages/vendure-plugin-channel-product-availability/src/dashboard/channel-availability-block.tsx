import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, Badge, Button, useAuth } from '@vendure/dashboard';
import { toast } from 'sonner';

import {
    clearProductChannelAvailabilityMutation,
    productChannelAvailabilitiesQuery,
    setProductChannelAvailabilityMutation,
} from './channel-availability.graphql';

const UPDATE_PERMISSIONS = ['UpdateCatalog', 'UpdateProduct'];

type Row = {
    channelId: string;
    channelCode: string;
    globalEnabled: boolean;
    override: boolean | null;
    overrideState: 'INHERITED' | 'ENABLED' | 'DISABLED';
    effectiveEnabled: boolean;
};

function isForbidden(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /not currently authorized|FORBIDDEN/i.test(message);
}

/**
 * Per-channel availability of the product shown on the product detail page.
 * Each action only changes the override for that one channel; the product's
 * global "Enabled" switch is never modified here.
 */
export function ChannelAvailabilityBlock({ productId }: { productId: string }) {
    const queryClient = useQueryClient();
    const { channels } = useAuth();
    const queryKey = ['productChannelAvailabilities', productId];

    const { data, isLoading, error } = useQuery({
        queryKey,
        queryFn: () => api.query(productChannelAvailabilitiesQuery, { productId }),
    });

    const onSuccess = () => queryClient.invalidateQueries({ queryKey });
    const onError = (err: unknown) =>
        toast.error('Could not update channel availability', {
            description: err instanceof Error ? err.message : 'Unknown error',
        });

    const setOverride = useMutation({
        mutationFn: (input: { channelId: string; enabled: boolean }) =>
            api.mutate(setProductChannelAvailabilityMutation, { input: { productId, ...input } }),
        onSuccess,
        onError,
    });
    const clearOverride = useMutation({
        mutationFn: (input: { channelId: string }) =>
            api.mutate(clearProductChannelAvailabilityMutation, { input: { productId, ...input } }),
        onSuccess,
        onError,
    });
    const busy = setOverride.isPending || clearOverride.isPending;

    const canUpdateIn = (channelId: string) => {
        const permissions = channels?.find(c => c.id === channelId)?.permissions ?? [];
        return UPDATE_PERMISSIONS.some(p => (permissions as string[]).includes(p));
    };

    if (isLoading) {
        return (
            <div className="space-y-2" aria-busy="true">
                <div className="h-10 animate-pulse rounded-md bg-muted" />
                <div className="h-10 animate-pulse rounded-md bg-muted" />
            </div>
        );
    }
    if (error) {
        return (
            <p className="text-sm text-destructive" role="alert">
                {isForbidden(error)
                    ? 'You do not have permission to view channel availability for this product.'
                    : `Could not load channel availability: ${error instanceof Error ? error.message : String(error)}`}
            </p>
        );
    }
    const rows = (data?.productChannelAvailabilities ?? []) as Row[];
    if (!rows.length) {
        return (
            <p className="text-sm text-muted-foreground">
                This product is not assigned to any channel you can manage.
            </p>
        );
    }

    const globalEnabled = rows[0].globalEnabled;
    const enabledDespiteGlobal = rows.filter(r => !r.globalEnabled && r.overrideState === 'ENABLED');

    return (
        <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
                Global status: <strong>{globalEnabled ? 'Enabled' : 'Disabled'}</strong>. Channels without an
                override follow it; an override always wins.
            </p>
            {enabledDespiteGlobal.length > 0 && (
                <p className="rounded-md border border-warning-border bg-warning/10 p-2 text-xs text-warning">
                    This product is disabled globally but explicitly enabled in{' '}
                    {enabledDespiteGlobal.map(r => r.channelCode).join(', ')}. Customers there can find and buy it.
                </p>
            )}
            <ul className="divide-y rounded-md border">
                {rows.map(row => {
                    const canUpdate = canUpdateIn(row.channelId);
                    return (
                        <li key={row.channelId} className="space-y-2 p-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-medium" title={row.channelCode}>
                                    {row.channelCode}
                                </span>
                                <Badge variant={row.effectiveEnabled ? 'success' : 'secondary'}>
                                    {row.effectiveEnabled ? 'Available' : 'Unavailable'}
                                </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                                {row.overrideState === 'INHERITED'
                                    ? 'Inherited from global status'
                                    : row.overrideState === 'ENABLED'
                                      ? 'Explicitly enabled in this channel'
                                      : 'Explicitly disabled in this channel'}
                            </div>
                            {canUpdate ? (
                                <div className="flex flex-wrap gap-1">
                                    {row.overrideState !== 'ENABLED' && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={busy}
                                            onClick={() => setOverride.mutate({ channelId: row.channelId, enabled: true })}
                                        >
                                            Enable
                                        </Button>
                                    )}
                                    {row.overrideState !== 'DISABLED' && (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={busy}
                                            onClick={() => setOverride.mutate({ channelId: row.channelId, enabled: false })}
                                        >
                                            Disable
                                        </Button>
                                    )}
                                    {row.overrideState !== 'INHERITED' && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            disabled={busy}
                                            onClick={() => clearOverride.mutate({ channelId: row.channelId })}
                                        >
                                            Use global
                                        </Button>
                                    )}
                                </div>
                            ) : (
                                <div className="text-xs text-muted-foreground">Read only</div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
