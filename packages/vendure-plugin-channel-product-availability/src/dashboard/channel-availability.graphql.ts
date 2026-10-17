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
