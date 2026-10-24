import gql from 'graphql-tag';

export const adminApiExtensions = gql`
    "The global Product.enabled value a start step sets."
    enum ProductLaunchAction {
        ENABLE
        DISABLE
    }

    """
    What happens at the end time. RESTORE puts back the value from before the start step, unless
    the product was changed manually in between (then nothing is changed).
    """
    enum ProductLaunchEndAction {
        ENABLE
        DISABLE
        RESTORE
    }

    """
    PENDING: waiting for the start step. ACTIVE: started, waiting for the end step.
    PROCESSING: a step is running. COMPLETED, FAILED, CANCELLED: finished.
    """
    enum ProductLaunchScheduleStatus {
        PENDING
        PROCESSING
        ACTIVE
        COMPLETED
        FAILED
        CANCELLED
    }

    enum ProductLaunchStep {
        START
        END
    }

    enum ProductLaunchExecutionOutcome {
        SUCCEEDED
        NO_CHANGE
        SKIPPED
        FAILED
    }

    """
    A scheduled change of a product's global enabled state. It applies to every channel.
    """
    type ProductLaunchSchedule implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        productId: ID!
        "Null if the product is not in the active channel."
        product: Product
        name: String
        description: String
        action: ProductLaunchAction!
        "UTC instant of the start step."
        scheduledAt: DateTime!
        "UTC instant of the end step, if any."
        endAt: DateTime
        endAction: ProductLaunchEndAction
        "The IANA time zone the times were entered in."
        timezone: String!
        "The start time as entered (YYYY-MM-DDTHH:mm in timezone)."
        localScheduledAt: String!
        "The end time as entered."
        localEndAt: String
        status: ProductLaunchScheduleStatus!
        nextStep: ProductLaunchStep
        "When the next step is due (UTC). Later than the scheduled time while a failed step waits to be retried."
        nextRunAt: DateTime
        "Attempts of the current step."
        attempts: Int!
        startEnabledBefore: Boolean
        startEnabledAfter: Boolean
        lastExecutedAt: DateTime
        lastError: String
        createdByUserId: ID
    }

    type ProductLaunchScheduleList implements PaginatedList {
        items: [ProductLaunchSchedule!]!
        totalItems: Int!
    }

    type ProductLaunchScheduleExecution implements Node {
        id: ID!
        createdAt: DateTime!
        scheduleId: ID!
        step: ProductLaunchStep!
        "ENABLE, DISABLE or RESTORE"
        action: String!
        outcome: ProductLaunchExecutionOutcome!
        enabledBefore: Boolean
        enabledAfter: Boolean
        attempt: Int!
        message: String
        ranLateBySeconds: Int!
        executedAt: DateTime!
    }

    type ProductLaunchScheduleExecutionList implements PaginatedList {
        items: [ProductLaunchScheduleExecution!]!
        totalItems: Int!
    }

    type ProductLaunchSchedulerStatus {
        "False when no scheduler strategy is configured (e.g. DefaultSchedulerPlugin is missing): nothing will run."
        schedulerRunning: Boolean!
        "The cron expression schedules are processed on."
        pollSchedule: String!
        maxAttempts: Int!
    }

    "The result of converting a local time, for previews in a UI."
    type ProductLaunchTimePreview {
        valid: Boolean!
        "UTC instant, when valid."
        instant: DateTime
        "The local time happens twice (DST); the earlier instant is used."
        ambiguous: Boolean!
        "INVALID_TIMEZONE, INVALID_LOCAL_TIME or INVALID_INPUT, when not valid."
        errorCode: String
        "For a time skipped by DST: the first valid local time after it."
        nextValidLocalTime: String
    }

    enum ProductLaunchScheduleSortField {
        scheduledAt
        nextRunAt
        createdAt
        updatedAt
    }

    input ProductLaunchScheduleListOptions {
        skip: Int
        take: Int
        productId: ID
        status: [ProductLaunchScheduleStatus!]
        "Schedules whose start or end is at or after this instant."
        from: DateTime
        "Schedules whose start is at or before this instant."
        to: DateTime
        sortBy: ProductLaunchScheduleSortField
        sortOrder: SortOrder
    }

    input ProductLaunchScheduleExecutionListOptions {
        skip: Int
        take: Int
    }

    input CreateProductLaunchScheduleInput {
        productId: ID!
        name: String
        description: String
        action: ProductLaunchAction!
        "Local start time, YYYY-MM-DDTHH:mm, in timezone."
        scheduledAt: String!
        "IANA time zone, e.g. Europe/Berlin."
        timezone: String!
        "Local end time, YYYY-MM-DDTHH:mm, in timezone."
        endAt: String
        "Defaults to DISABLE when endAt is set."
        endAction: ProductLaunchEndAction
    }

    """
    A PENDING schedule can be changed entirely; an ACTIVE one (started) only its end.
    """
    input UpdateProductLaunchScheduleInput {
        id: ID!
        name: String
        description: String
        action: ProductLaunchAction
        scheduledAt: String
        timezone: String
        endAt: String
        endAction: ProductLaunchEndAction
        "Removes the end step."
        removeEnd: Boolean
    }

    extend type Query {
        "Schedules of products in the active channel."
        productLaunchSchedules(options: ProductLaunchScheduleListOptions): ProductLaunchScheduleList!
        productLaunchSchedule(id: ID!): ProductLaunchSchedule
        productLaunchScheduleExecutions(
            scheduleId: ID!
            options: ProductLaunchScheduleExecutionListOptions
        ): ProductLaunchScheduleExecutionList!
        productLaunchSchedulerStatus: ProductLaunchSchedulerStatus!
        "Converts a local time to UTC without saving anything (for previews and validation in a UI)."
        productLaunchTimePreview(localTime: String!, timezone: String!): ProductLaunchTimePreview!
    }

    extend type Mutation {
        "Schedules a change of the product's global enabled state. Affects every channel."
        createProductLaunchSchedule(input: CreateProductLaunchScheduleInput!): ProductLaunchSchedule!
        updateProductLaunchSchedule(input: UpdateProductLaunchScheduleInput!): ProductLaunchSchedule!
        "Cancels a PENDING or ACTIVE schedule. Cancelling an ACTIVE one skips its end step and leaves the product as it is."
        cancelProductLaunchSchedule(id: ID!): ProductLaunchSchedule!
        "Runs a FAILED schedule's step again at the next poll."
        retryProductLaunchSchedule(id: ID!): ProductLaunchSchedule!
    }
`;
