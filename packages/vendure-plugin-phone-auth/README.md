# @rahul_vendure/vendure-plugin-phone-auth

A Vendure plugin for phone number + OTP authentication. No passwords — users sign up and log in purely via SMS verification codes.

Bring your own SMS provider by implementing a simple interface.

## Features

- **Unified OTP flow** — `requestOtp` + `verifyOtpAndLogin` handles both signup and login
- **Auto account creation** — new users get an account created automatically on first OTP verification
- **Phone number update** — authenticated users can change their phone number via OTP
- **Configurable SMS provider** — implement the `SmsProvider` interface with any SMS service (Twilio, AWS SNS, etc.)
- **Dev mode** — OTP is always `123456` and no SMS is sent, for local development
- **Phone validation** — uses `libphonenumber-js` for international phone number validation

## Installation

```bash
npm install @rahul_vendure/vendure-plugin-phone-auth
```

## Quick Start

```ts
import { PhoneAuthPlugin, ConsoleSmsProvider } from '@rahul_vendure/vendure-plugin-phone-auth';

const config: VendureConfig = {
    plugins: [
        PhoneAuthPlugin.init({
            smsProvider: new ConsoleSmsProvider(), // logs OTP to console
            devMode: true,
        }),
    ],
};
```

## Configuration

```ts
PhoneAuthPlugin.init({
    // Required: your SMS provider implementation
    smsProvider: new MyCustomSmsProvider(),

    // OTP time-to-live in milliseconds (default: 60000 = 60s)
    otpTtlMs: 60000,

    // Length of generated OTP code (default: 6)
    otpLength: 6,

    // SMS message template, use {code} as placeholder
    // (default: 'Your verification code is: {code}')
    messageTemplate: 'Your code: {code}',

    // Dev mode: OTP is always 123456, no SMS sent (default: false)
    devMode: false,

    // Domain for synthetic email addresses (default: 'phone-auth.local')
    // Vendure requires every customer to have an email. Since this plugin uses
    // phone-only auth, it generates a fake email like: +1234567890+noreply@phone-auth.local
    syntheticEmailDomain: 'phone-auth.local',
});
```

## Custom SMS Provider

Implement the `SmsProvider` interface to use any SMS service:

```ts
import { SmsProvider } from '@rahul_vendure/vendure-plugin-phone-auth';
import { RequestContext } from '@vendure/core';

class TwilioSmsProvider implements SmsProvider {
    async sendSms(ctx: RequestContext, phoneNumber: string, message: string): Promise<void> {
        await twilioClient.messages.create({
            body: message,
            to: phoneNumber,
            from: '+1234567890',
        });
    }
}
```

Then pass it in:

```ts
PhoneAuthPlugin.init({
    smsProvider: new TwilioSmsProvider(),
});
```

### Built-in Providers

| Provider | Description |
| --- | --- |
| `ConsoleSmsProvider` | Logs OTP to console. For development only. |

## GraphQL API

All mutations are on the **Shop API**.

### Public Mutations

#### `requestOtp`

Request an OTP code for any phone number. Works for both new and existing users.

```graphql
mutation {
    requestOtp(phoneNumber: "+1234567890") {
        ... on Success {
            success
            otpExpiresIn
        }
        ... on PhoneNumberValidationError {
            message
            errorCode
        }
    }
}
```

#### `verifyOtpAndLogin`

Verify OTP and log in. Creates an account automatically if the user doesn't exist.

```graphql
mutation {
    verifyOtpAndLogin(input: { phoneNumber: "+1234567890", code: "123456" }) {
        ... on CurrentUser {
            id
            identifier
        }
        ... on InvalidOtpError {
            message
            errorCode
        }
        ... on PhoneNumberValidationError {
            message
            errorCode
        }
    }
}
```

### Authenticated Mutations

#### `requestUpdatePhoneNumberOtp`

Request OTP to change the current user's phone number.

```graphql
mutation {
    requestUpdatePhoneNumberOtp(newPhoneNumber: "+0987654321") {
        ... on Success {
            success
            otpExpiresIn
        }
        ... on PhoneNumberValidationError {
            message
        }
        ... on PhoneNumberConflictError {
            message
        }
    }
}
```

#### `updatePhoneNumber`

Verify OTP and update the phone number.

```graphql
mutation {
    updatePhoneNumber(input: { phoneNumber: "+0987654321", code: "123456" }) {
        ... on Success {
            success
        }
        ... on InvalidOtpError {
            message
        }
        ... on PhoneNumberValidationError {
            message
        }
    }
}
```

## Error Types

| Error | Description |
| --- | --- |
| `InvalidOtpError` | OTP code is invalid or expired |
| `PhoneNumberValidationError` | Phone number format is invalid |
| `PhoneNumberConflictError` | Phone number is already registered to another account |
| `PhoneNotVerifiedError` | Phone number has not been verified |

## Custom Fields

This plugin adds the following custom field to the `User` entity:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `isPhoneVerified` | `boolean` | `false` | Whether the user's phone number has been verified via OTP |

> **Important:** If your project has `synchronize: false` in `dbConnectionOptions` (as it should in production), you need to generate and run a database migration after adding this plugin:
>
> ```bash
> npx vendure migrate
> ```
>
> This will create a migration that adds the `isPhoneVerified` column to the `user` table.

## How It Works

1. User calls `requestOtp` with their phone number
2. Plugin sends an OTP via the configured SMS provider
3. User calls `verifyOtpAndLogin` with the phone number and OTP code
4. If the user doesn't exist, an account is created automatically
5. User is logged in and a session token is returned

No passwords are involved at any point.

## Compatibility

- Vendure `^3.0.0`

## License

MIT
