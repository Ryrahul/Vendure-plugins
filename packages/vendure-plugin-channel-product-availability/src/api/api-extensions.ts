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
    }
`;
