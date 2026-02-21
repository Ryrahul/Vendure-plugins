# @rahul_vendure/vendure-plugin-wishlist

A Vendure plugin that adds wishlist functionality — customers can save product variants to their wishlist with single and bulk add/remove operations.

## Features

- **Add/remove single items** to wishlist
- **Bulk add/remove** multiple items in one mutation
- **Idempotent** — adding an already-wishlisted item returns the existing entry
- **`isInWishlist` field** on `ProductVariant` — easy to check in storefront queries
- **Paginated list** — uses Vendure's built-in `ListQueryBuilder` for filtering/sorting/pagination
- **Unique constraint** — a customer can only wishlist a variant once

## Installation

```bash
npm install @rahul_vendure/vendure-plugin-wishlist
```

## Setup

```ts
import { WishlistPlugin } from '@rahul_vendure/vendure-plugin-wishlist';

const config: VendureConfig = {
    plugins: [
        WishlistPlugin.init(),
    ],
};
```

> **Important:** This plugin creates a `wishlist_item` table. If your project has
> `synchronize: false`, you need to generate and run a database migration after
> adding this plugin:
>
> ```bash
> npx vendure migrate
> ```

## GraphQL API

All operations are on the **Shop API** and require authentication (`Permission.Owner`).

### Queries

#### `wishlists`

Get the current customer's wishlist with pagination.

```graphql
query {
    wishlists(options: { take: 10, skip: 0 }) {
        items {
            id
            createdAt
            productVariant {
                id
                name
                priceWithTax
                featuredAsset {
                    preview
                }
            }
        }
        totalItems
    }
}
```

### Mutations

#### `addToWishlist`

Add a single product variant. Returns the existing item if already wishlisted.

```graphql
mutation {
    addToWishlist(productVariantId: "42") {
        id
        productVariant {
            id
            name
        }
    }
}
```

#### `removeFromWishlist`

Remove by wishlist item ID or product variant ID (at least one required).

```graphql
mutation {
    removeFromWishlist(productVariantId: "42") {
        result
        message
    }
}
```

#### `addMultipleToWishlist`

Bulk add multiple variants at once. Skips duplicates.

```graphql
mutation {
    addMultipleToWishlist(productVariantIds: ["42", "43", "44"]) {
        id
        productVariant {
            id
            name
        }
    }
}
```

#### `removeMultipleFromWishlist`

Bulk remove by product variant IDs.

```graphql
mutation {
    removeMultipleFromWishlist(productVariantIds: ["42", "43"]) {
        result
    }
}
```

### Extended Fields

#### `ProductVariant.isInWishlist`

Returns `true` if the current customer has this variant in their wishlist.
Returns `false` for unauthenticated users.

```graphql
query {
    product(id: "1") {
        variants {
            id
            name
            isInWishlist
        }
    }
}
```

## Database

This plugin creates a `wishlist_item` table with:

| Column | Type | Description |
| --- | --- | --- |
| `id` | `ID` | Primary key |
| `customerId` | `ID` | Foreign key to `customer` |
| `productVariantId` | `ID` | Foreign key to `product_variant` |
| `createdAt` | `DateTime` | Auto-set on creation |
| `updatedAt` | `DateTime` | Auto-set on update |

A unique composite index on `(customerId, productVariantId)` prevents duplicates.

## Compatibility

- Vendure `^3.0.0`

## License

MIT
