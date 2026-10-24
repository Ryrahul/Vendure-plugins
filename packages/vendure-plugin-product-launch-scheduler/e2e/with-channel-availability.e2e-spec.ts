import { CurrencyCode, DefaultSchedulerPlugin, DefaultSearchPlugin, LanguageCode } from '@vendure/core';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ChannelProductAvailabilityPlugin } from '../../vendure-plugin-channel-product-availability/src';
import { ProductLaunchExecutorService, ProductLaunchSchedulerPlugin } from '../src';

import { CREATE_SCHEDULE, GET_PRODUCT } from './graphql';
import {
    awaitRunningJobs,
    createSchedulerTestEnvironment,
    ids,
    localIn,
    minutesFromNow,
    serverInitOptions,
} from './utils/test-environment';

const DEFAULT_TOKEN = 'e2e-default-channel';
const B_TOKEN = 'channel-b';

const SHOP_PRODUCT_AND_SEARCH = gql`
    query ($id: ID!) {
        product(id: $id) {
            id
        }
        search(input: { term: "laptop", groupByProduct: true }) {
            items {
                productId
            }
        }
    }
`;

describe('with the channel availability plugin', () => {
    const { server, adminClient, shopClient } = createSchedulerTestEnvironment(
        {},
        {
            plugins: [
                DefaultSearchPlugin.init({ bufferUpdates: false }),
                DefaultSchedulerPlugin.init(),
                ProductLaunchSchedulerPlugin.init(),
                ChannelProductAvailabilityPlugin.init(),
            ],
        },
    );
    let executor: ProductLaunchExecutorService;

    /** Whether the laptop is visible in the storefront of a channel (catalog, search). */
    async function visibility(token: string) {
        shopClient.setChannelToken(token);
        const result = await shopClient.query(SHOP_PRODUCT_AND_SEARCH, { id: ids.laptop });
        return { catalog: !!result.product, search: result.search.items.some((i: any) => i.productId === ids.laptop) };
    }

    beforeAll(async () => {
        await server.init(serverInitOptions);
        await adminClient.asSuperAdmin();
        executor = server.app.get(ProductLaunchExecutorService);

        const { zones } = await adminClient.query(gql`{ zones { items { id } } }`);
        const { createChannel } = await adminClient.query(
            gql`
                mutation ($zoneId: ID!) {
                    createChannel(
                        input: {
                            code: "channel-b"
                            token: "${B_TOKEN}"
                            defaultLanguageCode: ${LanguageCode.en}
                            pricesIncludeTax: false
                            defaultCurrencyCode: ${CurrencyCode.USD}
                            defaultShippingZoneId: $zoneId
                            defaultTaxZoneId: $zoneId
                        }
                    ) {
                        ... on Channel {
                            id
                        }
                    }
                }
            `,
            { zoneId: zones.items[0].id },
        );
        await adminClient.query(
            gql`
                mutation ($channelId: ID!) {
                    assignProductsToChannel(input: { productIds: ["T_1"], channelId: $channelId, priceFactor: 1 }) {
                        id
                    }
                }
            `,
            { channelId: createChannel.id },
        );
        // Channel B always sells the laptop, whatever the global setting
        await adminClient.query(
            gql`
                mutation ($channelId: ID!) {
                    setProductChannelAvailability(input: { productId: "T_1", channelId: $channelId, enabled: true }) {
                        effectiveEnabled
                    }
                }
            `,
            { channelId: createChannel.id },
        );
        await awaitRunningJobs(adminClient);
    });

    afterAll(async () => {
        await server.destroy();
    });

    it('a scheduled disable hides the product where it inherits, not where a channel override enables it', async () => {
        expect(await visibility(DEFAULT_TOKEN)).toEqual({ catalog: true, search: true });
        expect(await visibility(B_TOKEN)).toEqual({ catalog: true, search: true });

        await adminClient.query(CREATE_SCHEDULE, {
            input: { productId: ids.laptop, action: 'DISABLE', timezone: 'UTC', scheduledAt: localIn(2), endAt: localIn(30), endAction: 'RESTORE' },
        });
        await executor.processDue(minutesFromNow(3));
        await awaitRunningJobs(adminClient);

        expect((await adminClient.query(GET_PRODUCT, { id: ids.laptop })).product.enabled).toBe(false);
        expect(await visibility(DEFAULT_TOKEN)).toEqual({ catalog: false, search: false });
        expect(await visibility(B_TOKEN)).toEqual({ catalog: true, search: true });
    });

    it('restore brings it back everywhere', async () => {
        await executor.processDue(minutesFromNow(31));
        await awaitRunningJobs(adminClient);

        expect((await adminClient.query(GET_PRODUCT, { id: ids.laptop })).product.enabled).toBe(true);
        expect(await visibility(DEFAULT_TOKEN)).toEqual({ catalog: true, search: true });
        expect(await visibility(B_TOKEN)).toEqual({ catalog: true, search: true });
    });

    it('a channel override that disables keeps the product hidden after a scheduled enable', async () => {
        adminClient.setChannelToken(DEFAULT_TOKEN);
        const { activeChannel } = await adminClient.query(gql`{ activeChannel { id } }`);
        // hide it in the default channel only, then disable globally
        await adminClient.query(
            gql`
                mutation ($channelId: ID!) {
                    setProductChannelAvailability(input: { productId: "T_1", channelId: $channelId, enabled: false }) {
                        effectiveEnabled
                    }
                }
            `,
            { channelId: activeChannel.id },
        );
        await adminClient.query(gql`mutation { updateProduct(input: { id: "T_1", enabled: false }) { id } }`);
        await awaitRunningJobs(adminClient);

        await adminClient.query(CREATE_SCHEDULE, {
            input: { productId: ids.laptop, action: 'ENABLE', timezone: 'UTC', scheduledAt: localIn(40) },
        });
        await executor.processDue(minutesFromNow(41));
        await awaitRunningJobs(adminClient);

        expect((await adminClient.query(GET_PRODUCT, { id: ids.laptop })).product.enabled).toBe(true);
        expect(await visibility(DEFAULT_TOKEN)).toEqual({ catalog: false, search: false });
        expect(await visibility(B_TOKEN)).toEqual({ catalog: true, search: true });
    });
});
