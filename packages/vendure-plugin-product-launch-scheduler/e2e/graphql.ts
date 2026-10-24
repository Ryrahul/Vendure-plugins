import gql from 'graphql-tag';

export const SCHEDULE_FIELDS = gql`
    fragment ScheduleFields on ProductLaunchSchedule {
        id
        productId
        product {
            id
            name
            enabled
        }
        name
        description
        action
        scheduledAt
        endAt
        endAction
        timezone
        localScheduledAt
        localEndAt
        status
        nextStep
        nextRunAt
        attempts
        startEnabledBefore
        startEnabledAfter
        lastExecutedAt
        lastError
        createdByUserId
    }
`;

export const CREATE_SCHEDULE = gql`
    mutation CreateSchedule($input: CreateProductLaunchScheduleInput!) {
        createProductLaunchSchedule(input: $input) {
            ...ScheduleFields
        }
    }
    ${SCHEDULE_FIELDS}
`;

export const UPDATE_SCHEDULE = gql`
    mutation UpdateSchedule($input: UpdateProductLaunchScheduleInput!) {
        updateProductLaunchSchedule(input: $input) {
            ...ScheduleFields
        }
    }
    ${SCHEDULE_FIELDS}
`;

export const CANCEL_SCHEDULE = gql`
    mutation CancelSchedule($id: ID!) {
        cancelProductLaunchSchedule(id: $id) {
            ...ScheduleFields
        }
    }
    ${SCHEDULE_FIELDS}
`;

export const RETRY_SCHEDULE = gql`
    mutation RetrySchedule($id: ID!) {
        retryProductLaunchSchedule(id: $id) {
            ...ScheduleFields
        }
    }
    ${SCHEDULE_FIELDS}
`;

export const GET_SCHEDULE = gql`
    query GetSchedule($id: ID!) {
        productLaunchSchedule(id: $id) {
            ...ScheduleFields
        }
    }
    ${SCHEDULE_FIELDS}
`;

export const LIST_SCHEDULES = gql`
    query ListSchedules($options: ProductLaunchScheduleListOptions) {
        productLaunchSchedules(options: $options) {
            totalItems
            items {
                ...ScheduleFields
            }
        }
    }
    ${SCHEDULE_FIELDS}
`;

export const LIST_EXECUTIONS = gql`
    query ListExecutions($scheduleId: ID!) {
        productLaunchScheduleExecutions(scheduleId: $scheduleId) {
            totalItems
            items {
                id
                step
                action
                outcome
                enabledBefore
                enabledAfter
                attempt
                message
                ranLateBySeconds
                executedAt
            }
        }
    }
`;

export const SCHEDULER_STATUS = gql`
    query {
        productLaunchSchedulerStatus {
            schedulerRunning
            pollSchedule
            maxAttempts
        }
    }
`;

export const TIME_PREVIEW = gql`
    query TimePreview($localTime: String!, $timezone: String!) {
        productLaunchTimePreview(localTime: $localTime, timezone: $timezone) {
            valid
            instant
            ambiguous
            errorCode
            nextValidLocalTime
        }
    }
`;

export const GET_PRODUCT = gql`
    query GetProduct($id: ID!) {
        product(id: $id) {
            id
            enabled
        }
    }
`;

export const UPDATE_PRODUCT_ENABLED = gql`
    mutation UpdateProductEnabled($id: ID!, $enabled: Boolean!) {
        updateProduct(input: { id: $id, enabled: $enabled }) {
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

export const SHOP_PRODUCT = gql`
    query ShopProduct($id: ID!) {
        product(id: $id) {
            id
            name
        }
    }
`;

export const RUN_SCHEDULED_TASK = gql`
    mutation RunTask($id: String!) {
        runScheduledTask(id: $id) {
            success
        }
    }
`;
