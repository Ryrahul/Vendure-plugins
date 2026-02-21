import { ErrorResult } from '@vendure/core';

export class InvalidOtpError extends ErrorResult {
    readonly __typename = 'InvalidOtpError';
    readonly errorCode = 'INVALID_OTP_ERROR';
    readonly message = 'INVALID_OTP_ERROR';
}

export class PhoneNumberValidationError extends ErrorResult {
    readonly __typename = 'PhoneNumberValidationError';
    readonly errorCode = 'PHONE_NUMBER_VALIDATION_ERROR';
    readonly message = 'PHONE_NUMBER_VALIDATION_ERROR';
}

export class PhoneNumberConflictError extends ErrorResult {
    readonly __typename = 'PhoneNumberConflictError';
    readonly errorCode = 'PHONE_NUMBER_CONFLICT_ERROR';
    readonly message = 'PHONE_NUMBER_CONFLICT_ERROR';
}

export class PhoneNotVerifiedError extends ErrorResult {
    readonly __typename = 'PhoneNotVerifiedError';
    readonly errorCode = 'PHONE_NOT_VERIFIED_ERROR';
    readonly message = 'PHONE_NOT_VERIFIED_ERROR';
}
