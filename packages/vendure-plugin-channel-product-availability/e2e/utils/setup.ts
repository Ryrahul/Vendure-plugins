import { CurrencyCode, LanguageCode } from '@vendure/core';
import { SimpleGraphQLClient } from '@vendure/testing';
import path from 'path';

import { initialData } from '../fixtures/initial-data';
import {
    ASSIGN_COLLECTIONS_TO_CHANNEL,
    ASSIGN_PAYMENT_METHODS_TO_CHANNEL,
    ASSIGN_PRODUCTS_TO_CHANNEL,
    ASSIGN_SHIPPING_METHODS_TO_CHANNEL,
    CREATE_CHANNEL,
    GET_DEFAULT_CHANNEL,
    GET_ZONES,
} from '../graphql';
import { awaitRunningJobs } from './test-environment';

export const DEFAULT_CHANNEL_TOKEN = 'e2e-default-channel';
export const CHANNEL_B_TOKEN = 'channel-b-token';

/** Product / variant ids produced by fixtures/products.csv (TestingEntityIdStrategy). */
export const ids = {
    laptop: 'T_1',
    laptop13: 'T_1',
    laptop15: 'T_2',
    camera: 'T_2',
    cameraVariant: 'T_3',
    phone: 'T_3',
    phoneVariant: 'T_4',
    tablet: 'T_4',
    tabletVariant: 'T_5',
    headphones: 'T_5',
    headphonesVariant: 'T_6',
};

export const allProductIds = ['T_1', 'T_2', 'T_3', 'T_4', 'T_5'];

export const serverInitOptions = {
    initialData,
    productsCsvPath: path.join(__dirname, '../fixtures/products.csv'),
    customerCount: 1,
};

/**
 * Creates "Channel B", assigns every product, shipping and payment method to it,
 * and waits for indexing. Returns both channel ids.
 */
export async function setupChannels(adminClient: SimpleGraphQLClient) {
    adminClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
    const { activeChannel } = await adminClient.query(GET_DEFAULT_CHANNEL);
    const { zones } = await adminClient.query(GET_ZONES);
    const zoneId = zones.items[0].id;
    const { createChannel } = await adminClient.query(CREATE_CHANNEL, {
        input: {
            code: 'channel-b',
            token: CHANNEL_B_TOKEN,
            defaultLanguageCode: LanguageCode.en,
            pricesIncludeTax: false,
            defaultCurrencyCode: CurrencyCode.GBP,
            defaultShippingZoneId: zoneId,
            defaultTaxZoneId: zoneId,
        },
    });
    if (!createChannel.id) {
        throw new Error(`createChannel failed: ${createChannel.message}`);
    }
    await adminClient.query(ASSIGN_PRODUCTS_TO_CHANNEL, {
        input: { productIds: allProductIds, channelId: createChannel.id, priceFactor: 1 },
    });
    await adminClient.query(ASSIGN_SHIPPING_METHODS_TO_CHANNEL, {
        input: { shippingMethodIds: ['T_1'], channelId: createChannel.id },
    });
    await adminClient.query(ASSIGN_PAYMENT_METHODS_TO_CHANNEL, {
        input: { paymentMethodIds: ['T_1'], channelId: createChannel.id },
    });
    await adminClient.query(ASSIGN_COLLECTIONS_TO_CHANNEL, {
        input: { collectionIds: ['T_2'], channelId: createChannel.id },
    });
    await awaitRunningJobs(adminClient);
    return { channelA: activeChannel.id as string, channelB: createChannel.id as string };
}
