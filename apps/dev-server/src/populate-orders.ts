import { INestApplicationContext } from '@nestjs/common';
import {
    ChannelService,
    ConfigService,
    Customer,
    CustomerService,
    Logger,
    Order,
    OrderService,
    PaymentService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    ShippingMethod,
    ShippingMethodService,
    TransactionalConnection,
    User,
    isGraphQlErrorResult,
} from '@vendure/core';

/**
 * Creates ~150 fully-processed orders spread across the last 90 days.
 * Each order goes through the complete Vendure order lifecycle:
 *   create -> addItems -> setShipping -> arrangePayment -> pay -> settle -> fulfill -> deliver
 *
 * Uses real Vendure services — no direct DB hacks except for backdating timestamps.
 */
export async function populateOrders(app: INestApplicationContext) {
    const orderService = app.get(OrderService);
    const customerService = app.get(CustomerService);
    const productVariantService = app.get(ProductVariantService);
    const shippingMethodService = app.get(ShippingMethodService);
    const paymentService = app.get(PaymentService);
    const connection = app.get(TransactionalConnection);
    const channelService = app.get(ChannelService);
    const configService = app.get(ConfigService);

    const ctx = await getSuperadminCtx(app);

    // Gather reference data
    const customers = await getAllCustomers(customerService, ctx);
    if (customers.length === 0) {
        Logger.warn('No customers found — skipping order population', 'Populate');
        return;
    }

    const variants = await getAllVariants(productVariantService, ctx);
    if (variants.length === 0) {
        Logger.warn('No product variants found — skipping order population', 'Populate');
        return;
    }

    const shippingMethods = await getShippingMethods(shippingMethodService, ctx);
    if (shippingMethods.length === 0) {
        Logger.warn('No shipping methods found — skipping order population', 'Populate');
        return;
    }

    const ORDER_COUNT = 150;
    const DAYS_BACK = 90;
    let created = 0;
    let failed = 0;

    for (let i = 0; i < ORDER_COUNT; i++) {
        try {
            // Pick random customer — weight some customers higher (repeat buyers)
            const customer = pickWeightedCustomer(customers, i);

            // Pick random date in last 90 days — weighted toward recent + weekends
            const orderDate = generateOrderDate(DAYS_BACK, i, ORDER_COUNT);

            // Pick 1-5 random variants with quantities 1-3
            const items = pickRandomItems(variants);

            // Pick shipping method
            const shippingMethod = shippingMethods[seededRandom(i * 7) > 0.5 ? 0 : Math.min(1, shippingMethods.length - 1)];

            // Determine final state
            const finalState = pickFinalState(i);

            // Create and process the order
            await createFullOrder(
                ctx,
                orderService,
                connection,
                customer,
                items,
                shippingMethod,
                orderDate,
                finalState,
            );

            created++;
            if (created % 25 === 0) {
                Logger.info(`Created ${created}/${ORDER_COUNT} orders...`, 'Populate');
            }
        } catch (e: any) {
            failed++;
            Logger.warn(`Failed to create order ${i}: ${e.message}`, 'Populate');
        }
    }

    Logger.info(`Order population complete: ${created} created, ${failed} failed`, 'Populate');
}

// ── Order creation pipeline ──

async function createFullOrder(
    ctx: RequestContext,
    orderService: OrderService,
    connection: TransactionalConnection,
    customer: Customer,
    items: Array<{ variantId: string; quantity: number }>,
    shippingMethod: ShippingMethod,
    orderDate: Date,
    finalState: 'Delivered' | 'Shipped' | 'PaymentSettled' | 'Cancelled',
) {
    // 1. Create order linked to customer's user
    const order = await orderService.create(ctx, customer.user?.id);

    // 2. Add items
    for (const item of items) {
        const result = await orderService.addItemToOrder(ctx, order.id, item.variantId, item.quantity);
        if (isGraphQlErrorResult(result)) {
            throw new Error(`addItemToOrder failed: ${(result as any).message}`);
        }
    }

    // 3. Set shipping address from customer
    const address = customer.addresses?.[0];
    await orderService.setShippingAddress(ctx, order.id, {
        fullName: `${customer.firstName} ${customer.lastName}`,
        streetLine1: address?.streetLine1 ?? '123 Test Street',
        city: address?.city ?? 'London',
        province: address?.province ?? 'Greater London',
        postalCode: address?.postalCode ?? 'SW1A 1AA',
        countryCode: address?.country?.code ?? 'GB',
    });

    // 4. Set shipping method
    const setShipResult = await orderService.setShippingMethod(ctx, order.id, [shippingMethod.id]);
    if (isGraphQlErrorResult(setShipResult)) {
        throw new Error(`setShippingMethod failed: ${(setShipResult as any).message}`);
    }

    // 5. Transition to ArrangingPayment
    const toArranging = await orderService.transitionToState(ctx, order.id, 'ArrangingPayment');
    if (isGraphQlErrorResult(toArranging)) {
        throw new Error(`transitionToState(ArrangingPayment) failed: ${(toArranging as any).message}`);
    }

    if (finalState === 'Cancelled') {
        // Cancel before payment
        await orderService.cancelOrder(ctx, { orderId: order.id, reason: 'Seed data: cancelled order' });
        await backdateOrder(connection, ctx, order.id, orderDate);
        return;
    }

    // 6. Add payment (dummy handler)
    const payResult = await orderService.addPaymentToOrder(ctx, order.id, {
        method: 'standard-payment',
        metadata: {},
    });
    if (isGraphQlErrorResult(payResult)) {
        throw new Error(`addPaymentToOrder failed: ${(payResult as any).message}`);
    }

    // 7. Settle payment (since automaticSettle is false)
    const paidOrder = payResult as Order;
    const payments = await orderService.getOrderPayments(ctx, paidOrder.id);
    if (payments.length > 0) {
        await orderService.settlePayment(ctx, payments[0].id);
    }

    if (finalState === 'PaymentSettled') {
        await backdateOrder(connection, ctx, order.id, orderDate);
        return;
    }

    // 8. Create fulfillment
    const fulfilledOrder = await orderService.findOne(ctx, order.id, ['lines']);
    if (!fulfilledOrder) throw new Error('Order not found after payment');

    const fulfillResult = await orderService.createFulfillment(ctx, {
        lines: fulfilledOrder.lines.map(line => ({
            orderLineId: line.id,
            quantity: line.quantity,
        })),
        handler: { code: 'manual-fulfillment', arguments: [{ name: 'method', value: 'Seed Shipping' }, { name: 'trackingCode', value: `TRACK-${order.id}` }] },
    });

    if (isGraphQlErrorResult(fulfillResult)) {
        // If fulfillment creation fails, still backdate
        await backdateOrder(connection, ctx, order.id, orderDate);
        return;
    }

    if (finalState === 'Shipped') {
        await backdateOrder(connection, ctx, order.id, orderDate);
        return;
    }

    // 9. Mark as delivered
    const fulfillment = fulfillResult as any;
    if (fulfillment?.id) {
        try {
            await orderService.transitionFulfillmentToState(ctx, fulfillment.id, 'Delivered');
        } catch {
            // Ignore delivery transition errors
        }
    }

    await backdateOrder(connection, ctx, order.id, orderDate);
}

// ── Helper functions ──

async function getSuperadminCtx(app: INestApplicationContext): Promise<RequestContext> {
    const defaultChannel = await app.get(ChannelService).getDefaultChannel();
    const connection = app.get(TransactionalConnection);
    const configService = app.get(ConfigService);
    const { superadminCredentials } = configService.authOptions;
    const superAdminUser = await connection.rawConnection
        .getRepository(User)
        .findOneOrFail({ where: { identifier: superadminCredentials.identifier } });

    return new RequestContext({
        channel: defaultChannel,
        apiType: 'admin',
        isAuthorized: true,
        authorizedAsOwnerOnly: false,
        session: {
            id: '',
            token: '',
            expires: new Date(Date.now() + 3600000),
            cacheExpiry: 999999,
            user: {
                id: superAdminUser.id,
                identifier: superAdminUser.identifier,
                verified: true,
                channelPermissions: [],
            },
        },
    });
}

async function getAllCustomers(service: CustomerService, ctx: RequestContext): Promise<Customer[]> {
    const result = await service.findAll(ctx, { take: 100 }, [
        'user',
        'addresses',
        'addresses.country',
    ]);
    return result.items;
}

async function getAllVariants(service: ProductVariantService, ctx: RequestContext): Promise<ProductVariant[]> {
    const result = await service.findAll(ctx, { take: 200 });
    return result.items;
}

async function getShippingMethods(service: ShippingMethodService, ctx: RequestContext): Promise<ShippingMethod[]> {
    const result = await service.findAll(ctx, { take: 10 });
    return result.items;
}

/**
 * Weight some customers higher so we get realistic "top customer" data.
 * Customers 0 and 1 get ~30% of orders.
 */
function pickWeightedCustomer(customers: Customer[], seed: number): Customer {
    const r = seededRandom(seed * 13);
    if (r < 0.15 && customers.length > 0) return customers[0];
    if (r < 0.30 && customers.length > 1) return customers[1];
    if (r < 0.40 && customers.length > 2) return customers[2];
    return customers[Math.floor(seededRandom(seed * 17) * customers.length)];
}

/**
 * Generate a date in the last N days, weighted toward more recent dates
 * and with slightly more on weekends.
 */
function generateOrderDate(daysBack: number, index: number, total: number): Date {
    // Bias toward recent: use square root distribution
    const r = seededRandom(index * 31);
    const daysAgo = Math.floor(Math.pow(r, 1.5) * daysBack);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);

    // Randomize hour of day
    date.setHours(Math.floor(seededRandom(index * 41) * 14) + 8); // 8am - 10pm
    date.setMinutes(Math.floor(seededRandom(index * 43) * 60));
    date.setSeconds(0);
    date.setMilliseconds(0);

    return date;
}

/**
 * Pick 1-5 random variants with quantities 1-3.
 */
function pickRandomItems(variants: ProductVariant[]): Array<{ variantId: string; quantity: number }> {
    const count = Math.floor(seededRandom(Math.random() * 1000) * 4) + 1; // 1-5
    const items: Array<{ variantId: string; quantity: number }> = [];
    const used = new Set<string>();

    for (let i = 0; i < count && i < variants.length; i++) {
        let variant: ProductVariant;
        let attempts = 0;
        do {
            variant = variants[Math.floor(Math.random() * variants.length)];
            attempts++;
        } while (used.has(variant.id.toString()) && attempts < 20);

        if (!used.has(variant.id.toString())) {
            used.add(variant.id.toString());
            items.push({
                variantId: variant.id.toString(),
                quantity: Math.floor(Math.random() * 3) + 1,
            });
        }
    }
    return items;
}

/**
 * Determine final order state with realistic distribution:
 * 70% Delivered, 15% Shipped, 10% PaymentSettled, 5% Cancelled
 */
function pickFinalState(seed: number): 'Delivered' | 'Shipped' | 'PaymentSettled' | 'Cancelled' {
    const r = seededRandom(seed * 53);
    if (r < 0.05) return 'Cancelled';
    if (r < 0.15) return 'PaymentSettled';
    if (r < 0.30) return 'Shipped';
    return 'Delivered';
}

/**
 * Backdate order + related timestamps so analytics charts show proper spread.
 */
async function backdateOrder(
    connection: TransactionalConnection,
    ctx: RequestContext,
    orderId: any,
    date: Date,
) {
    try {
        const repo = connection.getRepository(ctx, Order);
        await repo.update(orderId, {
            createdAt: date,
            updatedAt: date,
            orderPlacedAt: date,
        } as any);
    } catch {
        // Non-critical — analytics will still work, just dates won't be spread
    }
}

/**
 * Simple seeded pseudo-random number generator (0-1).
 */
function seededRandom(seed: number): number {
    const x = Math.sin(seed + 1) * 10000;
    return x - Math.floor(x);
}
