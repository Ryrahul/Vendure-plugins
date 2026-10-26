/**
 * Creates two branch channels with all products and a few overrides, for trying the dashboard.
 */
const API = `http://localhost:${process.env.PORT ?? 3093}/admin-api`;
let token = '';

async function gql(query: string, variables: Record<string, unknown> = {}) {
    const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ query, variables }),
    });
    token = res.headers.get('vendure-auth-token') ?? token;
    const json: any = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
}

(async () => {
    await gql(`mutation { login(username: "superadmin", password: "superadmin") { ... on CurrentUser { id } } }`);
    const { zones } = await gql(`{ zones { items { id } } }`);
    const { products } = await gql(`{ products { items { id } } }`);
    for (const code of ['branch-kalanki', 'branch-boudha']) {
        const { createChannel } = await gql(
            `mutation ($code: String!, $zone: ID!) { createChannel(input: { code: $code, token: $code, defaultLanguageCode: en,
                pricesIncludeTax: false, defaultCurrencyCode: USD, defaultShippingZoneId: $zone, defaultTaxZoneId: $zone }) { ... on Channel { id } } }`,
            { code, zone: zones.items[0].id },
        );
        await gql(`mutation ($ids: [ID!]!, $ch: ID!) { assignProductsToChannel(input: { productIds: $ids, channelId: $ch, priceFactor: 1 }) { id } }`, {
            ids: products.items.map((p: any) => p.id),
            ch: createChannel.id,
        });
    }
    console.log('Channels ready');
})().catch(e => {
    console.error(e);
    process.exit(1);
});
