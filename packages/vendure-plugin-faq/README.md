# @rahul_vendure/vendure-plugin-faq

A Vendure plugin for managing Frequently Asked Questions with full i18n support, multi-channel awareness, soft deletes, and a React dashboard extension.

## Features

- **Translatable** — question and answer fields support multiple languages
- **Channel-aware** — FAQs can be assigned to specific channels
- **Soft deletes** — FAQs are soft-deleted, never permanently removed
- **Custom permissions** — CRUD permissions (`CreateFaq`, `ReadFaq`, `UpdateFaq`, `DeleteFaq`)
- **Dashboard UI** — full list/detail pages with bulk actions (delete, assign/remove channels)
- **Shop API** — public query returns only enabled FAQs
- **Admin API** — full CRUD with channel assignment

## Installation

```bash
npm install @rahul_vendure/vendure-plugin-faq
```

## Setup

```ts
import { FaqPlugin } from '@rahul_vendure/vendure-plugin-faq';

const config: VendureConfig = {
    plugins: [
        FaqPlugin.init(),
    ],
};
```

> **Important:** This plugin creates `faq` and `faq_translation` tables plus a
> junction table for channel assignment. If your project has `synchronize: false`,
> generate and run a migration:
>
> ```bash
> npx vendure migrate
> ```

## Dashboard

The plugin includes a React dashboard extension that adds:

- **"Help & Support" nav section** with an FAQs list page
- **FAQ detail page** with translatable question/answer fields and enabled toggle
- **Bulk actions** — delete, assign to channels, remove from channel

The dashboard extension is automatically picked up by Vendure's Vite build.

## GraphQL API

### Shop API

#### `faqs`

Returns only enabled FAQs, paginated.

```graphql
query {
    faqs(options: { take: 10 }) {
        items {
            id
            question
            answer
        }
        totalItems
    }
}
```

### Admin API

#### `faqs` / `faq`

```graphql
query {
    faqs(options: { take: 10 }) {
        items { id question answer enabled }
        totalItems
    }
}

query {
    faq(id: "1") { id question answer enabled translations { languageCode question answer } }
}
```

#### `createFaq`

```graphql
mutation {
    createFaq(input: {
        enabled: true
        translations: [
            { languageCode: en, question: "What is your return policy?", answer: "30 day returns." }
        ]
    }) {
        id question answer
    }
}
```

#### `updateFaq`

```graphql
mutation {
    updateFaq(input: {
        id: "1"
        enabled: false
        translations: [
            { id: "1", languageCode: en, question: "Updated question", answer: "Updated answer" }
        ]
    }) {
        id question answer enabled
    }
}
```

#### `deleteFaq`

Soft deletes one or more FAQs.

```graphql
mutation {
    deleteFaq(ids: ["1", "2"]) {
        result
        message
    }
}
```

#### `assignFaqsToChannels` / `removeFaqsFromCurrentChannel`

```graphql
mutation {
    assignFaqsToChannels(input: { faqIds: ["1", "2"], channelIds: ["3"] }) {
        id question
    }
}

mutation {
    removeFaqsFromCurrentChannel(faqIds: ["1"]) {
        id question
    }
}
```

## Permissions

| Permission | Description |
| --- | --- |
| `CreateFaq` | Create new FAQs |
| `ReadFaq` | View FAQs |
| `UpdateFaq` | Update FAQs and manage channel assignments |
| `DeleteFaq` | Soft-delete FAQs |

## Database

Creates the following tables:

- `faq` — main entity with `enabled`, `deletedAt` (soft delete)
- `faq_translation` — translations with `languageCode`, `question`, `answer`
- `faq_channels_channel` — junction table for channel assignment

## Compatibility

- Vendure `^3.0.0`

## License

MIT
