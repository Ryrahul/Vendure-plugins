import { I18nError, LogLevel } from '@vendure/core';

export type ProductLaunchScheduleErrorCode =
    | 'INVALID_TIMEZONE'
    | 'INVALID_LOCAL_TIME'
    | 'SCHEDULE_IN_PAST'
    | 'END_BEFORE_START'
    | 'SCHEDULE_CONFLICT'
    | 'INVALID_STATUS_TRANSITION'
    | 'PRODUCT_NOT_FOUND'
    | 'INVALID_INPUT';

/**
 * A validation error of the Product Launch Scheduler. The GraphQL error's `extensions.code` is
 * the `code`, so clients can branch on it.
 */
export class ProductLaunchScheduleError extends I18nError {
    constructor(
        public readonly errorCode: ProductLaunchScheduleErrorCode,
        message: string,
        variables: Record<string, string | number> = {},
    ) {
        super(message, variables, errorCode, LogLevel.Verbose);
    }
}
