import gql from 'graphql-tag';

export const shopApiExtensions = gql`
    input VerifyPhoneNumberInput {
        phoneNumber: String!
        code: String!
    }

    type InvalidOtpError implements ErrorResult {
        message: String!
        errorCode: ErrorCode!
    }

    type PhoneNumberValidationError implements ErrorResult {
        message: String!
        errorCode: ErrorCode!
    }

    type PhoneNumberConflictError implements ErrorResult {
        message: String!
        errorCode: ErrorCode!
    }

    type PhoneNotVerifiedError implements ErrorResult {
        message: String!
        errorCode: ErrorCode!
    }

    extend type Success {
        otpExpiresIn: Int
    }

    # --- Unified OTP flow (signup + login in one) ---

    union RequestOtpResult = Success | PhoneNumberValidationError

    union VerifyOtpAndLoginResult =
          CurrentUser
        | PhoneNumberValidationError
        | InvalidOtpError

    extend type Mutation {
        """
        Request an OTP code for the given phone number.
        Works for both new and existing users.
        """
        requestOtp(phoneNumber: String!): RequestOtpResult!

        """
        Verify the OTP code and log the user in.
        If the user does not exist, an account is created automatically.
        """
        verifyOtpAndLogin(input: VerifyPhoneNumberInput!): VerifyOtpAndLoginResult!
    }

    # --- Phone number update flow ---

    union RequestUpdatePhoneNumberOtpResult =
          Success
        | PhoneNumberValidationError
        | PhoneNumberConflictError

    union UpdatePhoneNumberResult =
          Success
        | PhoneNumberValidationError
        | InvalidOtpError

    extend type Mutation {
        """
        Request an OTP to update the current user's phone number.
        Requires authentication.
        """
        requestUpdatePhoneNumberOtp(newPhoneNumber: String!): RequestUpdatePhoneNumberOtpResult!

        """
        Verify the OTP and update the current user's phone number.
        Requires authentication.
        """
        updatePhoneNumber(input: VerifyPhoneNumberInput!): UpdatePhoneNumberResult!
    }
`;
