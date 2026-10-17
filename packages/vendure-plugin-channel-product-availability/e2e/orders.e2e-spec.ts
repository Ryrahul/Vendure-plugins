import { SimpleGraphQLClient } from '@vendure/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    ADD_ITEM_TO_DRAFT_ORDER,
    ADD_ITEM_TO_ORDER,
    ADD_ITEMS_TO_ORDER,
    ADD_PAYMENT,
    ADJUST_ORDER_LINE,
    CREATE_DRAFT_ORDER,
    GET_SHIPPING_METHODS,
    REMOVE_ORDER_LINE,
    SET_AVAILABILITY,
    SET_CUSTOMER,
    SET_SHIPPING_ADDRESS,
    SET_SHIPPING_METHOD,
    TRANSITION_TO_STATE,
    UPDATE_PRODUCT,
    UPDATE_VARIANTS,
} from './graphql';
import { DEFAULT_CHANNEL_TOKEN, ids, serverInitOptions, setupChannels } from './utils/setup';
import { awaitRunningJobs, createAvailabilityTestEnvironment } from './utils/test-environment';

describe('orders and checkout enforcement', () => {
    const { server, adminClient, shopClient } = createAvailabilityTestEnvironment();
    let channelA: string;

    beforeAll(async () => {
        await server.init(serverInitOptions);
        await adminClient.asSuperAdmin();
        ({ channelA } = await setupChannels(adminClient));
        // camera, laptop, phone: globally disabled, explicitly enabled in A
        for (const id of [ids.camera, ids.laptop, ids.phone]) {
            await adminClient.query(UPDATE_PRODUCT, { input: { id, enabled: false } });
            await adminClient.query(SET_AVAILABILITY, { input: { productId: id, channelId: channelA, enabled: true } });
        }
        await adminClient.query(UPDATE_VARIANTS, { input: [{ id: ids.laptop15, enabled: false }] });
        await awaitRunningJobs(adminClient);
    });

    afterAll(async () => {
        await server.destroy();
    });

    async function newGuest() {
        await shopClient.asAnonymousUser();
        shopClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
    }

    async function setOverride(productId: string, enabled: boolean) {
        await adminClient.query(SET_AVAILABILITY, { input: { productId, channelId: channelA, enabled } });
    }

    async function prepareCheckout(client: SimpleGraphQLClient) {
        await client.query(SET_CUSTOMER, {
            input: { emailAddress: `guest-${Date.now()}@test.com`, firstName: 'Guest', lastName: 'User' },
        });
        await client.query(SET_SHIPPING_ADDRESS, { input: { streetLine1: '1 Test Street', countryCode: 'GB' } });
        const { eligibleShippingMethods } = await client.query(GET_SHIPPING_METHODS);
        await client.query(SET_SHIPPING_METHOD, { id: [eligibleShippingMethods[0].id] });
    }

    it('completes a full checkout of a globally-disabled, channel-enabled product', async () => {
        await newGuest();
        const { addItemToOrder } = await shopClient.query(ADD_ITEM_TO_ORDER, {
            productVariantId: ids.cameraVariant,
            quantity: 2,
        });
        expect(addItemToOrder.__typename).toBe('Order');
        expect(addItemToOrder.totalQuantity).toBe(2);
        await prepareCheckout(shopClient);
        const { transitionOrderToState } = await shopClient.query(TRANSITION_TO_STATE, { state: 'ArrangingPayment' });
        expect(transitionOrderToState.state).toBe('ArrangingPayment');
        const { addPaymentToOrder } = await shopClient.query(ADD_PAYMENT, {
            input: { method: 'test-payment', metadata: {} },
        });
        expect(addPaymentToOrder).toMatchObject({ __typename: 'Order', state: 'PaymentSettled' });
    });

    it('merges repeated adds into one line with prices applied', async () => {
        await newGuest();
        await shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: ids.cameraVariant, quantity: 1 });
        const { addItemToOrder } = await shopClient.query(ADD_ITEM_TO_ORDER, {
            productVariantId: ids.cameraVariant,
            quantity: 2,
        });
        expect(addItemToOrder.lines).toHaveLength(1);
        expect(addItemToOrder.lines[0].quantity).toBe(3);
    });

    it('still enforces variant.enabled under an enabling override', async () => {
        await newGuest();
        await expect(
            shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: ids.laptop15, quantity: 1 }),
        ).rejects.toThrow(/No ProductVariant with the id/);
        const { addItemToOrder } = await shopClient.query(ADD_ITEM_TO_ORDER, {
            productVariantId: ids.laptop13,
            quantity: 1,
        });
        expect(addItemToOrder.__typename).toBe('Order');
    });

    it('still enforces stock under an enabling override, without leaving an empty line', async () => {
        await newGuest();
        const { addItemToOrder } = await shopClient.query(ADD_ITEM_TO_ORDER, {
            productVariantId: ids.phoneVariant,
            quantity: 1,
        });
        expect(addItemToOrder).toMatchObject({ errorCode: 'INSUFFICIENT_STOCK_ERROR', quantityAvailable: 0 });
    });

    it('partial stock: adds what is saleable and reports InsufficientStockError (existing line)', async () => {
        await adminClient.query(UPDATE_VARIANTS, { input: [{ id: ids.phoneVariant, stockOnHand: 3 }] });
        await newGuest();
        await shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: ids.phoneVariant, quantity: 1 });
        const { addItemToOrder } = await shopClient.query(ADD_ITEM_TO_ORDER, {
            productVariantId: ids.phoneVariant,
            quantity: 5,
        });
        expect(addItemToOrder).toMatchObject({ errorCode: 'INSUFFICIENT_STOCK_ERROR', quantityAvailable: 2 });
        const { addItemToOrder: after } = await shopClient.query(ADD_ITEM_TO_ORDER, {
            productVariantId: ids.cameraVariant,
            quantity: 1,
        });
        expect(after.lines.find((l: any) => l.productVariant.id === ids.phoneVariant).quantity).toBe(3);
        await adminClient.query(UPDATE_VARIANTS, { input: [{ id: ids.phoneVariant, stockOnHand: 0 }] });
    });

    it('rejects products explicitly disabled in the channel (globally enabled)', async () => {
        await setOverride(ids.tablet, false);
        await newGuest();
        const { addItemToOrder } = await shopClient.query(ADD_ITEM_TO_ORDER, {
            productVariantId: ids.tabletVariant,
            quantity: 1,
        });
        expect(addItemToOrder.errorCode).toBe('ORDER_INTERCEPTOR_ERROR');
        expect(addItemToOrder.interceptorError).toMatch(/not available in the current channel/);
        await adminClient.query(SET_AVAILABILITY, { input: { productId: ids.tablet, channelId: channelA, enabled: true } });
    });

    it('addItemsToOrder handles a mixed batch', async () => {
        await setOverride(ids.tablet, false);
        await newGuest();
        const { addItemsToOrder } = await shopClient.query(ADD_ITEMS_TO_ORDER, {
            inputs: [
                { productVariantId: ids.cameraVariant, quantity: 1 }, // override path
                { productVariantId: ids.headphonesVariant, quantity: 1 }, // core path
                { productVariantId: ids.tabletVariant, quantity: 1 }, // explicitly disabled
            ],
        });
        const variantIds = addItemsToOrder.order.lines.map((l: any) => l.productVariant.id).sort();
        expect(variantIds).toEqual([ids.cameraVariant, ids.headphonesVariant].sort());
        expect(addItemsToOrder.errorResults).toHaveLength(1);
        expect(addItemsToOrder.errorResults[0].errorCode).toBe('ORDER_INTERCEPTOR_ERROR');
        await setOverride(ids.tablet, true);
    });

    describe('availability changes after items are in the cart', () => {
        let tabletLineId: string;

        it('setup: cart with tablet (qty 3) and headphones', async () => {
            await setOverride(ids.tablet, true);
            await newGuest();
            await shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: ids.headphonesVariant, quantity: 1 });
            const { addItemToOrder } = await shopClient.query(ADD_ITEM_TO_ORDER, {
                productVariantId: ids.tabletVariant,
                quantity: 3,
            });
            tabletLineId = addItemToOrder.lines.find((l: any) => l.productVariant.id === ids.tabletVariant).id;
            await setOverride(ids.tablet, false);
        });

        it('blocks quantity increases', async () => {
            const { adjustOrderLine } = await shopClient.query(ADJUST_ORDER_LINE, {
                orderLineId: tabletLineId,
                quantity: 4,
            });
            expect(adjustOrderLine.errorCode).toBe('ORDER_INTERCEPTOR_ERROR');
        });

        it('allows quantity decreases', async () => {
            const { adjustOrderLine } = await shopClient.query(ADJUST_ORDER_LINE, {
                orderLineId: tabletLineId,
                quantity: 2,
            });
            expect(adjustOrderLine.__typename).toBe('Order');
        });

        it('blocks checkout while the line is present', async () => {
            await prepareCheckout(shopClient);
            const { transitionOrderToState } = await shopClient.query(TRANSITION_TO_STATE, {
                state: 'ArrangingPayment',
            });
            expect(transitionOrderToState.errorCode).toBe('ORDER_STATE_TRANSITION_ERROR');
            expect(transitionOrderToState.transitionError).toMatch(/not available in this channel/);
        });

        it('allows checkout once the line is removed', async () => {
            const { removeOrderLine } = await shopClient.query(REMOVE_ORDER_LINE, { orderLineId: tabletLineId });
            expect(removeOrderLine.__typename).toBe('Order');
            const { transitionOrderToState } = await shopClient.query(TRANSITION_TO_STATE, {
                state: 'ArrangingPayment',
            });
            expect(transitionOrderToState.state).toBe('ArrangingPayment');
            await setOverride(ids.tablet, true);
        });
    });

    it('admin draft orders can add override-enabled products', async () => {
        adminClient.setChannelToken(DEFAULT_CHANNEL_TOKEN);
        const { createDraftOrder } = await adminClient.query(CREATE_DRAFT_ORDER);
        const { addItemToDraftOrder } = await adminClient.query(ADD_ITEM_TO_DRAFT_ORDER, {
            orderId: createDraftOrder.id,
            input: { productVariantId: ids.cameraVariant, quantity: 1 },
        });
        expect(addItemToDraftOrder.lines.map((l: any) => l.productVariant.id)).toEqual([ids.cameraVariant]);
    });

    it('globally disabled product without an override is still rejected (core behaviour)', async () => {
        await adminClient.query(UPDATE_PRODUCT, { input: { id: ids.headphones, enabled: false } });
        await newGuest();
        await expect(
            shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: ids.headphonesVariant, quantity: 1 }),
        ).rejects.toThrow(/No ProductVariant with the id/);
        await adminClient.query(UPDATE_PRODUCT, { input: { id: ids.headphones, enabled: true } });
    });
});
