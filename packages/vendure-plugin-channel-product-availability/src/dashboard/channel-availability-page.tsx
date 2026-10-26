import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    api,
    BulkActionComponent,
    Button,
    ChannelCodeLabel,
    DashboardRouteDefinition,
    DataTableBulkActionItem,
    FullWidthPageBlock,
    Input,
    Link,
    Page,
    PageLayout,
    PageTitle,
    Skeleton,
    useAuth,
    useNavigate,
} from '@vendure/dashboard';
import { AlertTriangle, Eye, EyeOff, Globe, Loader2, Store, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
    clearProductChannelAvailabilitiesMutation,
    clearProductChannelAvailabilityMutation,
    productChannelAvailabilityOverridesQuery,
    productsByIdsQuery,
    setProductChannelAvailabilitiesMutation,
} from './channel-availability.graphql';

// Plain elements for pills, toggles and checkboxes: identical in Vendure <=3.7 and 3.8+.

const READ_PERMISSIONS = ['ReadCatalog', 'ReadProduct'];
const UPDATE_PERMISSIONS = ['UpdateCatalog', 'UpdateProduct'];
const PAGE_SIZE = 20;
const PATH = '/channel-availability';

type Target = 'DISABLED' | 'ENABLED' | 'INHERITED';
type BulkResult = { updated: number; unchanged: number; skipped: Array<{ productId: string; channelId: string; reason: string }> };

function cx(...classes: Array<string | false | null | undefined>) {
    return classes.filter(Boolean).join(' ');
}

function errorMessage(error: unknown) {
    return (error instanceof Error ? error.message : String(error)).replace(/^\[GraphQL\]\s*/, '');
}

function useChannelsWith(permissions: string[]) {
    const { channels } = useAuth();
    return useMemo(
        () =>
            (channels ?? []).filter(c =>
                ((c.permissions ?? []) as string[]).some(p => p === 'SuperAdmin' || permissions.includes(p)),
            ),
        [channels, permissions],
    );
}

/** Product ids passed by the bulk action, as `?productIds=1,2,3`. */
function initialProductIds(): string[] {
    try {
        return (new URLSearchParams(window.location.search).get('productIds') ?? '').split(',').filter(Boolean);
    } catch {
        return [];
    }
}

/** Product list → "Availability in channels…": opens the page with the selected products. */
export const ChannelAvailabilityBulkAction: BulkActionComponent<any> = ({ selection }) => {
    const navigate = useNavigate();
    const channels = useChannelsWith(UPDATE_PERMISSIONS);
    if (channels.length < 1) {
        return null;
    }
    return (
        <DataTableBulkActionItem
            requiresPermission={UPDATE_PERMISSIONS}
            label="Availability in channels…"
            icon={Store}
            onClick={() =>
                navigate({ to: PATH as any, search: { productIds: selection.map((p: any) => p.id).join(',') } as any })
            }
        />
    );
};

export const channelAvailabilityRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'catalog',
        id: 'channel-availability',
        url: PATH,
        title: 'Channel availability',
        requiresPermission: READ_PERMISSIONS,
    },
    path: PATH,
    loader: () => ({ breadcrumb: 'Channel availability' }),
    component: () => <ChannelAvailabilityPage />,
};

function ChannelAvailabilityPage() {
    const [productIds, setProductIds] = useState<string[]>(initialProductIds);
    return (
        <Page pageId="channel-availability">
            <PageTitle>Channel availability</PageTitle>
            <PageLayout>
                <FullWidthPageBlock blockId="channel-availability-page">
                    <div className="space-y-8">
                        {productIds.length > 0 && (
                            <BulkChange productIds={productIds} onDone={() => setProductIds([])} />
                        )}
                        <OverridesInChannel />
                    </div>
                </FullWidthPageBlock>
            </PageLayout>
        </Page>
    );
}

/** Applies On / Off / Global to the selected products in the chosen channels. */
function BulkChange({ productIds, onDone }: { productIds: string[]; onDone: () => void }) {
    const queryClient = useQueryClient();
    const channels = useChannelsWith(UPDATE_PERMISSIONS);
    const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
    const [target, setTarget] = useState<Target>('DISABLED');
    const [result, setResult] = useState<BulkResult | null>(null);

    const { data: products, isLoading } = useQuery({
        queryKey: ['channelAvailabilityProducts', productIds],
        queryFn: () => api.query(productsByIdsQuery, { ids: productIds }),
    });
    const names = new Map((products?.products.items ?? []).map((p: any) => [String(p.id), p.name as string]));

    const mutation = useMutation({
        mutationFn: async (): Promise<BulkResult> => {
            if (target === 'INHERITED') {
                const response = await api.mutate(clearProductChannelAvailabilitiesMutation, {
                    input: { productIds, channelIds: selectedChannels },
                });
                return response.clearProductChannelAvailabilities as BulkResult;
            }
            const response = await api.mutate(setProductChannelAvailabilitiesMutation, {
                input: { productIds, channelIds: selectedChannels, enabled: target === 'ENABLED' },
            });
            return response.setProductChannelAvailabilities as BulkResult;
        },
        onSuccess: data => {
            setResult(data);
            toast.success(`${data.updated} changed, ${data.unchanged} already set${data.skipped.length ? `, ${data.skipped.length} skipped` : ''}`);
            void queryClient.invalidateQueries({ queryKey: ['productChannelAvailabilityOverrides'] });
            void queryClient.invalidateQueries({ queryKey: ['productChannelAvailabilities'] });
        },
        onError: err => toast.error('Could not change availability', { description: errorMessage(err) }),
    });

    const pairs = productIds.length * selectedChannels.length;
    const channelCode = (id: string) => channels.find(c => c.id === id)?.code ?? id;

    return (
        <section className="space-y-4 rounded-lg border bg-card p-4" aria-label="Change availability">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-base font-semibold">
                        Change availability of {productIds.length} product{productIds.length === 1 ? '' : 's'}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {isLoading ? (
                            <Skeleton className="h-4 w-64" />
                        ) : (
                            productIds.map(id => names.get(id) ?? `#${id}`).join(', ')
                        )}
                    </p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={onDone} aria-label="Close">
                    <X className="h-4 w-4" />
                </Button>
            </div>

            <div>
                <p className="mb-2 text-xs font-medium">In channels</p>
                <div className="flex flex-wrap gap-2">
                    {channels.map(channel => {
                        const checked = selectedChannels.includes(channel.id);
                        return (
                            <label
                                key={channel.id}
                                className={cx(
                                    'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm',
                                    checked && 'border-primary bg-primary/5',
                                )}
                            >
                                <input
                                    type="checkbox"
                                    className="h-3.5 w-3.5"
                                    checked={checked}
                                    onChange={() =>
                                        setSelectedChannels(current =>
                                            checked ? current.filter(id => id !== channel.id) : [...current, channel.id],
                                        )
                                    }
                                />
                                <ChannelCodeLabel code={channel.code} />
                            </label>
                        );
                    })}
                </div>
            </div>

            <div>
                <p className="mb-2 text-xs font-medium">Set to</p>
                <div role="radiogroup" aria-label="Availability" className="inline-grid grid-cols-3 gap-0.5 rounded-md bg-muted p-0.5">
                    {(
                        [
                            { value: 'DISABLED', label: 'Off', icon: <EyeOff className="h-3.5 w-3.5" />, hint: 'Hidden and not sold in these channels' },
                            { value: 'ENABLED', label: 'On', icon: <Eye className="h-3.5 w-3.5" />, hint: 'Sold in these channels, even if globally disabled' },
                            { value: 'INHERITED', label: 'Global', icon: <Globe className="h-3.5 w-3.5" />, hint: "Remove the override: follow the product's own Enabled setting" },
                        ] as Array<{ value: Target; label: string; icon: React.ReactNode; hint: string }>
                    ).map(option => (
                        <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={target === option.value}
                            title={option.hint}
                            onClick={() => setTarget(option.value)}
                            className={cx(
                                'inline-flex items-center justify-center gap-1.5 rounded-[5px] px-4 py-1.5 text-sm font-medium transition-all',
                                target === option.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {option.icon}
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex items-center gap-3">
                <Button type="button" disabled={!selectedChannels.length || mutation.isPending} onClick={() => mutation.mutate()}>
                    {mutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                    Apply to {pairs} product × channel pair{pairs === 1 ? '' : 's'}
                </Button>
                {pairs > 1000 && <span className="text-xs text-destructive">At most 1,000 pairs at once.</span>}
            </div>

            {result && (
                <div role="status" className="rounded-md border bg-muted/30 p-3 text-sm">
                    <p>
                        <strong>{result.updated}</strong> changed · <strong>{result.unchanged}</strong> already set ·{' '}
                        <strong>{result.skipped.length}</strong> skipped
                    </p>
                    {result.skipped.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                            {result.skipped.map(s => (
                                <li key={`${s.productId}-${s.channelId}`} className="flex gap-1">
                                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                                    {names.get(s.productId) ?? `#${s.productId}`} in {channelCode(s.channelId)}: {s.reason}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </section>
    );
}

/** The explicit overrides of one channel, with search, filter, paging and inline clear. */
function OverridesInChannel() {
    const queryClient = useQueryClient();
    const readable = useChannelsWith(READ_PERMISSIONS);
    const updatable = useChannelsWith(UPDATE_PERMISSIONS);
    const [channelId, setChannelId] = useState<string | undefined>(undefined);
    const [state, setState] = useState<'ALL' | 'ON' | 'OFF'>('ALL');
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [page, setPage] = useState(0);

    useEffect(() => {
        if (!channelId && readable.length) {
            setChannelId(readable[0].id);
        }
    }, [channelId, readable]);
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
            setPage(0);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    const options = {
        channelId,
        enabled: state === 'ALL' ? undefined : state === 'ON',
        productName: debouncedSearch || undefined,
        skip: page * PAGE_SIZE,
        take: PAGE_SIZE,
    };
    const { data, isLoading, error, isFetching } = useQuery({
        queryKey: ['productChannelAvailabilityOverrides', options],
        queryFn: () => api.query(productChannelAvailabilityOverridesQuery, { options }),
        enabled: !!channelId,
        placeholderData: previous => previous,
    });

    const clear = useMutation({
        mutationFn: (productId: string) => api.mutate(clearProductChannelAvailabilityMutation, { input: { productId, channelId } }),
        onSuccess: () => {
            toast.success('Override removed: the product follows its global setting again');
            void queryClient.invalidateQueries({ queryKey: ['productChannelAvailabilityOverrides'] });
            void queryClient.invalidateQueries({ queryKey: ['productChannelAvailabilities'] });
        },
        onError: err => toast.error('Could not remove the override', { description: errorMessage(err) }),
    });

    const canUpdate = updatable.some(c => c.id === channelId);
    const rows = (data?.productChannelAvailabilityOverrides.items ?? []) as any[];
    const total = data?.productChannelAvailabilityOverrides.totalItems ?? 0;

    return (
        <section className="space-y-4" aria-label="Overrides in a channel">
            <div>
                <h2 className="text-base font-semibold">Overrides in a channel</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Products switched on or off in this channel, whatever their global setting. Products not listed follow their
                    own Enabled setting. To change several products, select them in the product list and choose “Availability in
                    channels…”.
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <select
                    aria-label="Channel"
                    value={channelId ?? ''}
                    onChange={e => {
                        setChannelId(e.target.value);
                        setPage(0);
                    }}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                    {readable.map(channel => (
                        <option key={channel.id} value={channel.id}>
                            {channel.code === '__default_channel__' ? 'Default channel' : channel.code}
                        </option>
                    ))}
                </select>
                <div role="group" aria-label="Filter" className="inline-flex gap-0.5 rounded-md bg-muted p-0.5">
                    {(['ALL', 'OFF', 'ON'] as const).map(value => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={state === value}
                            onClick={() => {
                                setState(value);
                                setPage(0);
                            }}
                            className={cx(
                                'rounded-[5px] px-3 py-1 text-xs font-medium',
                                state === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {value === 'ALL' ? 'All' : value === 'ON' ? 'On' : 'Off'}
                        </button>
                    ))}
                </div>
                <Input
                    className="h-9 w-64"
                    placeholder="Search by product name"
                    value={search}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                />
                {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            {isLoading ? (
                <div className="space-y-2" aria-busy="true">
                    {[0, 1, 2].map(i => (
                        <Skeleton key={i} className="h-10 w-full" />
                    ))}
                </div>
            ) : error ? (
                <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {/not currently authorized|FORBIDDEN/i.test(errorMessage(error))
                        ? 'You do not have permission to view this channel.'
                        : `Could not load overrides. ${errorMessage(error)}`}
                </p>
            ) : rows.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                    {debouncedSearch || state !== 'ALL' ? 'No overrides match these filters.' : 'No overrides in this channel: every product follows its global setting.'}
                </div>
            ) : (
                <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                            <tr>
                                <th className="px-3 py-2 font-medium">Product</th>
                                <th className="px-3 py-2 font-medium">In this channel</th>
                                <th className="px-3 py-2 font-medium">Global setting</th>
                                <th className="px-3 py-2 font-medium">Changed</th>
                                <th className="px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(row => (
                                <tr key={row.id} className="border-t">
                                    <td className="px-3 py-2">
                                        <Link to={`/products/${row.productId}` as any} className="font-medium hover:underline">
                                            {row.productName ?? `Product ${row.productId}`}
                                        </Link>
                                    </td>
                                    <td className="px-3 py-2">
                                        <span
                                            className={cx(
                                                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                                                row.enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
                                            )}
                                        >
                                            {row.enabled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                                            {row.enabled ? 'On' : 'Off'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-xs text-muted-foreground">
                                        {row.productEnabled == null ? '—' : row.productEnabled ? 'Enabled' : 'Disabled'}
                                    </td>
                                    <td className="px-3 py-2 text-xs text-muted-foreground">
                                        {new Date(row.updatedAt).toLocaleString()}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        {canUpdate && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                disabled={clear.isPending}
                                                onClick={() => clear.mutate(row.productId)}
                                                title="Remove the override: follow the global setting"
                                            >
                                                <Globe className="mr-1 h-3.5 w-3.5" />
                                                Use global
                                            </Button>
                                        )}
                                    </td>
                                </tr>
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
                        <Button type="button" variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>
                            Next
                        </Button>
                    </span>
                </div>
            )}
        </section>
    );
}
