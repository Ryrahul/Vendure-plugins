import gql from 'graphql-tag';

const AVAILABILITY_FIELDS = gql`
    fragment Availability on ProductChannelAvailability {
        productId
        channelId
        channelCode
        globalEnabled
        override
        overrideState
        effectiveEnabled
        productInChannel
    }
`;

export const SET_AVAILABILITY = gql`
    mutation SetAvailability($input: SetProductChannelAvailabilityInput!) {
        setProductChannelAvailability(input: $input) {
            ...Availability
        }
    }
    ${AVAILABILITY_FIELDS}
`;

export const CLEAR_AVAILABILITY = gql`
    mutation ClearAvailability($input: ClearProductChannelAvailabilityInput!) {
        clearProductChannelAvailability(input: $input) {
            ...Availability
        }
    }
    ${AVAILABILITY_FIELDS}
`;

export const GET_AVAILABILITY = gql`
    query GetAvailability($productId: ID!, $channelId: ID) {
        productChannelAvailability(productId: $productId, channelId: $channelId) {
            ...Availability
        }
    }
    ${AVAILABILITY_FIELDS}
`;

export const GET_AVAILABILITIES = gql`
    query GetAvailabilities($productId: ID!) {
        productChannelAvailabilities(productId: $productId) {
            ...Availability
        }
    }
    ${AVAILABILITY_FIELDS}
`;

export const GET_OVERRIDES = gql`
    query GetOverrides($options: ProductChannelAvailabilityOverrideListOptions) {
        productChannelAvailabilityOverrides(options: $options) {
            items {
                id
                productId
                channelId
                enabled
            }
            totalItems
        }
    }
`;

// ---- Admin core ----

export const UPDATE_PRODUCT = gql`
    mutation UpdateProduct($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
            enabled
        }
    }
`;

export const ADMIN_GET_PRODUCT = gql`
    query AdminGetProduct($id: ID!) {
        product(id: $id) {
            id
            enabled
        }
    }
`;

export const UPDATE_VARIANTS = gql`
    mutation UpdateVariants($input: [UpdateProductVariantInput!]!) {
        updateProductVariants(input: $input) {
            id
            enabled
        }
    }
`;

export const DELETE_PRODUCT = gql`
    mutation DeleteProduct($id: ID!) {
        deleteProduct(id: $id) {
            result
        }
    }
`;

export const GET_ZONES = gql`
    query GetZones {
        zones {
            items {
                id
                name
            }
        }
    }
`;

export const GET_DEFAULT_CHANNEL = gql`
    query GetActiveChannel {
        activeChannel {
            id
            code
        }
    }
`;

export const CREATE_CHANNEL = gql`
    mutation CreateChannel($input: CreateChannelInput!) {
        createChannel(input: $input) {
            ... on Channel {
                id
                code
                token
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const ASSIGN_PRODUCTS_TO_CHANNEL = gql`
    mutation AssignProducts($input: AssignProductsToChannelInput!) {
        assignProductsToChannel(input: $input) {
            id
        }
    }
`;

export const REMOVE_PRODUCTS_FROM_CHANNEL = gql`
    mutation RemoveProducts($input: RemoveProductsFromChannelInput!) {
        removeProductsFromChannel(input: $input) {
            id
        }
    }
`;

export const ASSIGN_SHIPPING_METHODS_TO_CHANNEL = gql`
    mutation AssignShippingMethods($input: AssignShippingMethodsToChannelInput!) {
        assignShippingMethodsToChannel(input: $input) {
            id
        }
    }
`;

export const ASSIGN_COLLECTIONS_TO_CHANNEL = gql`
    mutation AssignCollections($input: AssignCollectionsToChannelInput!) {
        assignCollectionsToChannel(input: $input) {
            id
        }
    }
`;

export const ASSIGN_PAYMENT_METHODS_TO_CHANNEL = gql`
    mutation AssignPaymentMethods($input: AssignPaymentMethodsToChannelInput!) {
        assignPaymentMethodsToChannel(input: $input) {
            id
        }
    }
`;

export const CREATE_ROLE = gql`
    mutation CreateRole($input: CreateRoleInput!) {
        createRole(input: $input) {
            id
        }
    }
`;

export const CREATE_ADMINISTRATOR = gql`
    mutation CreateAdministrator($input: CreateAdministratorInput!) {
        createAdministrator(input: $input) {
            id
        }
    }
`;

export const CREATE_DRAFT_ORDER = gql`
    mutation CreateDraftOrder {
        createDraftOrder {
            id
        }
    }
`;

export const ADD_ITEM_TO_DRAFT_ORDER = gql`
    mutation AddItemToDraftOrder($orderId: ID!, $input: AddItemToDraftOrderInput!) {
        addItemToDraftOrder(orderId: $orderId, input: $input) {
            ... on Order {
                id
                lines {
                    id
                    quantity
                    productVariant {
                        id
                    }
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const GET_COLLECTIONS = gql`
    query GetCollections {
        collections {
            items {
                id
                slug
            }
        }
    }
`;

// ---- Shop ----

export const SHOP_GET_PRODUCT = gql`
    query ShopGetProduct($id: ID, $slug: String) {
        product(id: $id, slug: $slug) {
            id
            slug
            variants {
                id
            }
        }
    }
`;

export const SHOP_GET_PRODUCTS = gql`
    query ShopGetProducts($options: ProductListOptions) {
        products(options: $options) {
            items {
                id
                slug
            }
            totalItems
        }
    }
`;

export const SHOP_COLLECTION_VARIANTS = gql`
    query ShopCollectionVariants($slug: String!, $options: ProductVariantListOptions) {
        collection(slug: $slug) {
            id
            productVariants(options: $options) {
                items {
                    id
                    productId
                }
                totalItems
            }
        }
    }
`;

export const SHOP_SEARCH = gql`
    query ShopSearch($input: SearchInput!) {
        search(input: $input) {
            items {
                productId
                productVariantId
            }
            totalItems
        }
    }
`;

const ORDER_RESULT = gql`
    fragment OrderResult on Order {
        id
        code
        state
        totalQuantity
        lines {
            id
            quantity
            productVariant {
                id
            }
        }
    }
`;

export const ADD_ITEM_TO_ORDER = gql`
    mutation AddItemToOrder($productVariantId: ID!, $quantity: Int!) {
        addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) {
            __typename
            ...OrderResult
            ... on ErrorResult {
                errorCode
                message
            }
            ... on InsufficientStockError {
                quantityAvailable
            }
            ... on OrderInterceptorError {
                interceptorError
            }
        }
    }
    ${ORDER_RESULT}
`;

export const ADD_ITEMS_TO_ORDER = gql`
    mutation AddItemsToOrder($inputs: [AddItemInput!]!) {
        addItemsToOrder(inputs: $inputs) {
            order {
                ...OrderResult
            }
            errorResults {
                ... on ErrorResult {
                    errorCode
                    message
                }
                ... on OrderInterceptorError {
                    interceptorError
                }
            }
        }
    }
    ${ORDER_RESULT}
`;

export const ADJUST_ORDER_LINE = gql`
    mutation AdjustOrderLine($orderLineId: ID!, $quantity: Int!) {
        adjustOrderLine(orderLineId: $orderLineId, quantity: $quantity) {
            __typename
            ...OrderResult
            ... on ErrorResult {
                errorCode
                message
            }
            ... on OrderInterceptorError {
                interceptorError
            }
        }
    }
    ${ORDER_RESULT}
`;

export const REMOVE_ORDER_LINE = gql`
    mutation RemoveOrderLine($orderLineId: ID!) {
        removeOrderLine(orderLineId: $orderLineId) {
            __typename
            ...OrderResult
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
    ${ORDER_RESULT}
`;

export const SET_CUSTOMER = gql`
    mutation SetCustomer($input: CreateCustomerInput!) {
        setCustomerForOrder(input: $input) {
            __typename
        }
    }
`;

export const SET_SHIPPING_ADDRESS = gql`
    mutation SetShippingAddress($input: CreateAddressInput!) {
        setOrderShippingAddress(input: $input) {
            __typename
        }
    }
`;

export const GET_SHIPPING_METHODS = gql`
    query GetShippingMethods {
        eligibleShippingMethods {
            id
        }
    }
`;

export const SET_SHIPPING_METHOD = gql`
    mutation SetShippingMethod($id: [ID!]!) {
        setOrderShippingMethod(shippingMethodId: $id) {
            __typename
        }
    }
`;

export const TRANSITION_TO_STATE = gql`
    mutation Transition($state: String!) {
        transitionOrderToState(state: $state) {
            __typename
            ... on Order {
                id
                state
            }
            ... on OrderStateTransitionError {
                errorCode
                message
                transitionError
            }
        }
    }
`;

export const ADD_PAYMENT = gql`
    mutation AddPayment($input: PaymentInput!) {
        addPaymentToOrder(input: $input) {
            __typename
            ... on Order {
                id
                state
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;
