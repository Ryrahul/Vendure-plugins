/**
 * Whether a product has an explicit override in a channel.
 *
 * - `INHERITED`: no override row, the global `Product.enabled` applies
 * - `ENABLED` / `DISABLED`: explicit override, takes precedence over the global flag
 */
export type OverrideState = 'INHERITED' | 'ENABLED' | 'DISABLED';

/** `undefined` / `null` mean "no override". */
export type OverrideValue = boolean | null | undefined;

/**
 * The single expression of the availability rule. Every enforcement layer in the
 * plugin goes through this function (via ChannelProductAvailabilityService).
 */
export function resolveEffectiveEnabled(globalEnabled: boolean, override: OverrideValue): boolean {
    return override == null ? globalEnabled : override;
}

export function toOverrideState(override: OverrideValue): OverrideState {
    if (override == null) {
        return 'INHERITED';
    }
    return override ? 'ENABLED' : 'DISABLED';
}

/**
 * Builds the ListQueryBuilder filter that selects products which are effectively
 * enabled, given the explicit override id sets of one channel.
 *
 *   (enabled = true AND id NOT IN disabled) OR id IN enabled
 *
 * Empty sets are omitted rather than emitted as `IN ()`.
 */
export function buildEffectiveEnabledProductFilter(enabledIds: string[], disabledIds: string[]): Record<string, any> {
    const globallyEnabled: Record<string, any> = disabledIds.length
        ? { _and: [{ enabled: { eq: true } }, { id: { notIn: disabledIds } }] }
        : { enabled: { eq: true } };
    if (!enabledIds.length) {
        return globallyEnabled;
    }
    return { _or: [globallyEnabled, { id: { in: enabledIds } }] };
}

/**
 * Combines a caller-supplied filter with a mandatory guard using AND semantics while
 * preserving the caller's `filterOperator` over their own fields. Mirrors core's
 * `enforceGuardFilter` (3.8) so the guard cannot be bypassed with `filterOperator: OR`.
 */
export function enforceGuardFilter<T extends { filter?: any; filterOperator?: any; [key: string]: any }>(
    options: T | undefined,
    guard: Record<string, any>,
): T {
    const userFilter = options?.filter;
    if (!userFilter || Object.keys(userFilter).length === 0) {
        return { ...(options as T), filter: guard, filterOperator: undefined };
    }
    const userBlock = options?.filterOperator === 'OR' ? { _or: [userFilter] } : { _and: [userFilter] };
    return { ...(options as T), filter: { _and: [userBlock, guard] }, filterOperator: undefined };
}
