import gql from 'graphql-tag';

export const shopApiExtensions = gql`
    type WishlistItem implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        productVariant: ProductVariant!
    }

    type WishlistItemList implements PaginatedList {
        items: [WishlistItem!]!
        totalItems: Int!
    }

    input WishlistItemListOptions

    extend type Query {
        wishlists(options: WishlistItemListOptions): WishlistItemList!
    }

    extend type Mutation {
        addToWishlist(productVariantId: ID!): WishlistItem!
        """
        Removes a wishlist item by its id or product variant id.
        At least one must be specified.
        """
        removeFromWishlist(id: ID, productVariantId: ID): DeletionResponse!
        """
        Adds multiple product variants to wishlist at once.
        """
        addMultipleToWishlist(productVariantIds: [ID!]!): [WishlistItem!]!
        """
        Removes multiple wishlist items by their product variant ids.
        """
        removeMultipleFromWishlist(productVariantIds: [ID!]!): DeletionResponse!
    }

    extend type ProductVariant {
        isInWishlist: Boolean!
    }
`;
