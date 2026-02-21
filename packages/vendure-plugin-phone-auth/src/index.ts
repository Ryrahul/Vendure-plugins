export { PhoneAuthPlugin } from './phone-auth.plugin';
export { PhoneAuthPluginOptions, SmsProvider, ConsoleSmsProvider } from './types';
export { PhoneAuthenticationStrategy } from './strategy/phone-authentication.strategy';
export {
    InvalidOtpError,
    PhoneNumberValidationError,
    PhoneNumberConflictError,
    PhoneNotVerifiedError,
} from './errors/phone-auth.errors';
