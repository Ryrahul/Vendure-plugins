import { RequestContext } from '@vendure/core';

/**
 * Interface that SMS providers must implement.
 * Users of this plugin bring their own SMS provider by
 * implementing this interface.
 *
 * @example
 * ```ts
 * import { SmsProvider } from '@rahul/vendure-plugin-phone-auth';
 *
 * class TwilioSmsProvider implements SmsProvider {
 *     async sendSms(ctx, phoneNumber, message) {
 *         // send via Twilio SDK
 *     }
 * }
 * ```
 */
export interface SmsProvider {
    /**
     * Send an SMS message to the given phone number.
     * Should throw an error if the message could not be sent.
     */
    sendSms(ctx: RequestContext, phoneNumber: string, message: string): Promise<void>;
}

/**
 * A simple console-logging SMS provider for development/testing.
 * Logs OTP codes to stdout instead of actually sending them.
 */
export class ConsoleSmsProvider implements SmsProvider {
    async sendSms(_ctx: RequestContext, phoneNumber: string, message: string): Promise<void> {
        // eslint-disable-next-line no-console
        console.log(`[ConsoleSmsProvider] SMS to ${phoneNumber}: ${message}`);
    }
}

/**
 * Configuration options for PhoneAuthPlugin.
 */
export interface PhoneAuthPluginOptions {
    /**
     * The SMS provider used to send OTP codes.
     * You must supply your own implementation of the SmsProvider interface.
     *
     * For development, you can use `ConsoleSmsProvider` which logs to console.
     */
    smsProvider: SmsProvider;

    /**
     * Time-to-live for OTP codes in milliseconds.
     *
     * @default 60000 (60 seconds)
     */
    otpTtlMs?: number;

    /**
     * Length of the generated OTP code.
     *
     * @default 6
     */
    otpLength?: number;

    /**
     * The message template sent via SMS. Use `{code}` as placeholder.
     *
     * @default 'Your verification code is: {code}'
     */
    messageTemplate?: string;

    /**
     * If true, OTP is always '123456' and no SMS is sent.
     * Useful for local development and testing.
     *
     * @default false
     */
    devMode?: boolean;

    /**
     * The domain used for synthetic email addresses generated for phone-only users.
     * Vendure requires every customer to have an email, so this plugin generates
     * a deterministic fake email from the phone number (e.g. `+1234567890+noreply@phone-auth.local`).
     *
     * @default 'phone-auth.local'
     */
    syntheticEmailDomain?: string;
}
