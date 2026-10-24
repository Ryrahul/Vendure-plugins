import { graphql } from '@/gql';

export const scheduleFragment = graphql(`
    fragment LaunchScheduleRow on ProductLaunchSchedule {
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
        lastExecutedAt
        lastError
    }
`);

export const productLaunchSchedulesQuery = graphql(
    `
        query ProductLaunchSchedules($options: ProductLaunchScheduleListOptions) {
            productLaunchSchedules(options: $options) {
                totalItems
                items {
                    ...LaunchScheduleRow
                }
            }
        }
    `,
    [scheduleFragment],
);

export const productLaunchSchedulerStatusQuery = graphql(`
    query ProductLaunchSchedulerStatus {
        productLaunchSchedulerStatus {
            schedulerRunning
            pollSchedule
            maxAttempts
        }
    }
`);

export const productLaunchTimePreviewQuery = graphql(`
    query ProductLaunchTimePreview($localTime: String!, $timezone: String!) {
        productLaunchTimePreview(localTime: $localTime, timezone: $timezone) {
            valid
            instant
            ambiguous
            errorCode
            nextValidLocalTime
        }
    }
`);

export const productLaunchScheduleExecutionsQuery = graphql(`
    query ProductLaunchScheduleExecutions($scheduleId: ID!) {
        productLaunchScheduleExecutions(scheduleId: $scheduleId, options: { take: 50 }) {
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
`);

export const createProductLaunchScheduleMutation = graphql(
    `
        mutation CreateProductLaunchSchedule($input: CreateProductLaunchScheduleInput!) {
            createProductLaunchSchedule(input: $input) {
                ...LaunchScheduleRow
            }
        }
    `,
    [scheduleFragment],
);

export const updateProductLaunchScheduleMutation = graphql(
    `
        mutation UpdateProductLaunchSchedule($input: UpdateProductLaunchScheduleInput!) {
            updateProductLaunchSchedule(input: $input) {
                ...LaunchScheduleRow
            }
        }
    `,
    [scheduleFragment],
);

export const cancelProductLaunchScheduleMutation = graphql(
    `
        mutation CancelProductLaunchSchedule($id: ID!) {
            cancelProductLaunchSchedule(id: $id) {
                ...LaunchScheduleRow
            }
        }
    `,
    [scheduleFragment],
);

export const retryProductLaunchScheduleMutation = graphql(
    `
        mutation RetryProductLaunchSchedule($id: ID!) {
            retryProductLaunchSchedule(id: $id) {
                ...LaunchScheduleRow
            }
        }
    `,
    [scheduleFragment],
);
