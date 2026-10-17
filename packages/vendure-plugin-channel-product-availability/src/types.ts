/**
 * Options for {@link ChannelProductAvailabilityPlugin}.
 *
 * Every switch defaults to `true`. Turning one off removes that layer of
 * enforcement; it never changes how the availability rule itself is computed.
 */
export interface ChannelProductAvailabilityPluginOptions {
    /**
     * Override the Shop API `products`, `product` and `Collection.productVariants`
     * resolvers so catalog discovery uses the channel-aware rule.
     *
     * Disable only if another plugin already overrides these resolvers and you
     * apply the rule there yourself via `ChannelProductAvailabilityService`.
     *
     * @default true
     */
    enforceCatalog?: boolean;
    /**
     * Override the Shop API `addItemToOrder` / `addItemsToOrder` and Admin API
     * `addItemToDraftOrder` mutations so that products explicitly enabled in a
     * channel can be purchased even when `Product.enabled` is false.
     *
     * Explicitly disabled products are always rejected by the plugin's
     * OrderInterceptor, regardless of this option.
     *
     * @default true
     */
    enableOverridePurchasing?: boolean;
    /**
     * Keep the DefaultSearchPlugin index (`search_index_item`) in sync with
     * channel overrides. Has no effect when DefaultSearchPlugin is not installed.
     *
     * @default true
     */
    syncDefaultSearchIndex?: boolean;
    /**
     * Block the transition to `ArrangingPayment` when the order contains a line
     * whose product is explicitly disabled in the order's channel.
     *
     * @default true
     */
    validateOnCheckout?: boolean;
}

export type ResolvedChannelProductAvailabilityOptions = Required<ChannelProductAvailabilityPluginOptions>;

export const defaultOptions: ResolvedChannelProductAvailabilityOptions = {
    enforceCatalog: true,
    enableOverridePurchasing: true,
    syncDefaultSearchIndex: true,
    validateOnCheckout: true,
};

// GraphQL input/args types are generated into ./generated-graphql-types.ts
