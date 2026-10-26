import gql from 'graphql-tag';

export const adminApiExtensions = gql`
    """
    INHERITED: no override, the global Product.enabled applies.
    ENABLED / DISABLED: explicit channel override, takes precedence over Product.enabled.
    """
    enum ProductChannelAvailabilityOverrideState {
        INHERITED
        ENABLED
        DISABLED
    }

    type ProductChannelAvailability {
        productId: ID!
        channelId: ID!
        channelCode: String!
        "The global Product.enabled value."
        globalEnabled: Boolean!
        "The explicit override for this channel, or null when inherited."
        override: Boolean
        overrideState: ProductChannelAvailabilityOverrideState!
        "What the storefront and checkout enforce in this channel."
        effectiveEnabled: Boolean!
        productInChannel: Boolean!
        updatedAt: DateTime
    }

    type ProductChannelAvailabilityOverride {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        productId: ID!
        channelId: ID!
        enabled: Boolean!
        "The product's name in the request language."
        productName: String
        "The global Product.enabled value."
        productEnabled: Boolean
    }

    type ProductChannelAvailabilityOverrideList {
        items: [ProductChannelAvailabilityOverride!]!
        totalItems: Int!
    }

    input ProductChannelAvailabilityOverrideListOptions {
        "Defaults to the active channel."
        channelId: ID
        productId: ID
        enabled: Boolean
        "Products whose name contains this text (case-insensitive)."
        productName: String
        skip: Int
        take: Int
    }

    input SetProductChannelAvailabilityInput {
        productId: ID!
        "Defaults to the active channel."
        channelId: ID
        enabled: Boolean!
    }

    input ClearProductChannelAvailabilityInput {
        productId: ID!
        "Defaults to the active channel."
        channelId: ID
    }

    "Sets the override for every (product, channel) pair. At most 1,000 pairs per call."
    input SetProductChannelAvailabilitiesInput {
        productIds: [ID!]!
        channelIds: [ID!]!
        enabled: Boolean!
    }

    "Clears the override for every (product, channel) pair. At most 1,000 pairs per call."
    input ClearProductChannelAvailabilitiesInput {
        productIds: [ID!]!
        channelIds: [ID!]!
    }

    type BulkAvailabilitySkip {
        productId: ID!
        channelId: ID!
        reason: String!
    }

    type BulkProductChannelAvailabilityResult {
        "Overrides created, changed or removed."
        updated: Int!
        "Pairs that already had the requested state."
        unchanged: Int!
        "Pairs that could not be applied (e.g. the product is not assigned to the channel); the rest still apply."
        skipped: [BulkAvailabilitySkip!]!
    }

    extend type Query {
        "Availability of a product in one channel (default: the active channel)."
        productChannelAvailability(productId: ID!, channelId: ID): ProductChannelAvailability!
        "Availability of a product in every channel it is assigned to that the current administrator can read."
        productChannelAvailabilities(productId: ID!): [ProductChannelAvailability!]!
        "Explicit overrides in a channel (default: the active channel)."
        productChannelAvailabilityOverrides(
            options: ProductChannelAvailabilityOverrideListOptions
        ): ProductChannelAvailabilityOverrideList!
    }

    extend type Mutation {
        "Sets an explicit override. Does not change Product.enabled or channel assignment."
        setProductChannelAvailability(input: SetProductChannelAvailabilityInput!): ProductChannelAvailability!
        "Removes the override so the product inherits Product.enabled again."
        clearProductChannelAvailability(input: ClearProductChannelAvailabilityInput!): ProductChannelAvailability!
        "Sets overrides for many products in many channels, in one transaction. Requires permission in every channel."
        setProductChannelAvailabilities(input: SetProductChannelAvailabilitiesInput!): BulkProductChannelAvailabilityResult!
        "Clears overrides for many products in many channels, in one transaction. Requires permission in every channel."
        clearProductChannelAvailabilities(input: ClearProductChannelAvailabilitiesInput!): BulkProductChannelAvailabilityResult!
    }
`;
