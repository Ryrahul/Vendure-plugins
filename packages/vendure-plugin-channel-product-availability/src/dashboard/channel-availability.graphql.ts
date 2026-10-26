import { graphql } from '@/gql';

const availabilityFragment = graphql(`
    fragment ChannelAvailabilityRow on ProductChannelAvailability {
        productId
        channelId
        channelCode
        globalEnabled
        override
        overrideState
        effectiveEnabled
        productInChannel
        updatedAt
    }
`);

export const productChannelAvailabilitiesQuery = graphql(
    `
        query ProductChannelAvailabilities($productId: ID!) {
            productChannelAvailabilities(productId: $productId) {
                ...ChannelAvailabilityRow
            }
        }
    `,
    [availabilityFragment],
);

export const setProductChannelAvailabilityMutation = graphql(
    `
        mutation SetProductChannelAvailability($input: SetProductChannelAvailabilityInput!) {
            setProductChannelAvailability(input: $input) {
                ...ChannelAvailabilityRow
            }
        }
    `,
    [availabilityFragment],
);

export const clearProductChannelAvailabilityMutation = graphql(
    `
        mutation ClearProductChannelAvailability($input: ClearProductChannelAvailabilityInput!) {
            clearProductChannelAvailability(input: $input) {
                ...ChannelAvailabilityRow
            }
        }
    `,
    [availabilityFragment],
);

export const productChannelAvailabilityOverridesQuery = graphql(`
    query ProductChannelAvailabilityOverrides($options: ProductChannelAvailabilityOverrideListOptions) {
        productChannelAvailabilityOverrides(options: $options) {
            totalItems
            items {
                id
                productId
                channelId
                enabled
                productName
                productEnabled
                updatedAt
            }
        }
    }
`);

export const setProductChannelAvailabilitiesMutation = graphql(`
    mutation SetProductChannelAvailabilities($input: SetProductChannelAvailabilitiesInput!) {
        setProductChannelAvailabilities(input: $input) {
            updated
            unchanged
            skipped {
                productId
                channelId
                reason
            }
        }
    }
`);

export const clearProductChannelAvailabilitiesMutation = graphql(`
    mutation ClearProductChannelAvailabilities($input: ClearProductChannelAvailabilitiesInput!) {
        clearProductChannelAvailabilities(input: $input) {
            updated
            unchanged
            skipped {
                productId
                channelId
                reason
            }
        }
    }
`);

export const productsByIdsQuery = graphql(`
    query ChannelAvailabilityProductsByIds($ids: [String!]!) {
        products(options: { filter: { id: { in: $ids } }, take: 1000 }) {
            items {
                id
                name
                enabled
            }
        }
    }
`);
