# @rahul_vendure/vendure-plugin-extra-promotions

Additional promotion conditions and actions for Vendure beyond the built-in defaults, with a dashboard extension for collection picker inputs.

## Features

### Conditions

| Condition | Code | Description |
| --- | --- | --- |
| **First Order** | `first_order` | Customer is placing their first order |
| **Min Order Count** | `min_order_count` | Customer has placed at least N previous orders (loyalty) |
| **Collection Contains** | `order_contains_products_in_collections` | Order contains items from specified collections |
| **Not In Collection** | `order_contains_products_not_in_collections` | Order contains items NOT in specified collections |
| **Min Stock Level** | `min_stock_level` | Order contains overstocked items (stock clearance) |
| **Time Range** | `time_range` | Current time is within a time window (Happy Hour) |
| **Weekday** | `weekday` | Current day matches specified days of the week |
| **Cross-Sell** | `cross_sell` | Order contains trigger products |
| **Happy Hours Collection** | `happy_hours_collection` | Happy hour time window + items from selected collections |

### Actions

| Action | Code | Description |
| --- | --- | --- |
| **Collection Discount** | `collection_percentage_discount` | Percentage discount on items in specified collections |
| **Exclude Collection Discount** | `exclude_collection_percentage_discount` | Percentage discount on items NOT in specified collections |
| **Stock Clearance Discount** | `stock_clearance_discount` | Percentage discount on overstocked items only |
| **Cross-Sell Discount** | `cross_sell_discount` | Discount target products when trigger products are in the order |
| **Happy Hours Collection Discount** | `happy_hours_collection_discount` | Percentage discount on items in selected collections during happy hour |

### Dashboard Extension

- Custom **collection picker** form input for selecting collections in promotion condition/action args

## Installation

```bash
npm install @rahul_vendure/vendure-plugin-extra-promotions
```

## Setup

```ts
import { ExtraPromotionsPlugin } from '@rahul_vendure/vendure-plugin-extra-promotions';

const config: VendureConfig = {
    plugins: [
        ExtraPromotionsPlugin,
    ],
};
```

No `.init()` call needed — the plugin registers all conditions and actions automatically.

## Paired Conditions & Actions

Some actions are designed to work with specific conditions:

- **Stock Clearance**: Use `min_stock_level` condition with `stock_clearance_discount` action. The condition identifies overstocked lines, and the action discounts only those lines.
- **Cross-Sell**: Use `cross_sell` condition with `cross_sell_discount` action. The condition checks for trigger products and identifies target lines, the action discounts the targets.
- **Happy Hours Collection**: Use `happy_hours_collection` condition with `happy_hours_collection_discount` action. The condition checks the time window and identifies lines from selected collections, the action discounts only those lines.

> **Tip:** For a happy-hour discount on **all** products (no collection filter), use the standalone `time_range` condition with any built-in Vendure discount action.

## Compatibility

- Vendure `^3.0.0`

## License

MIT
