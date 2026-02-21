import { RequestContext } from '@vendure/core';
import { SmsProvider } from '@rahul_vendure/vendure-plugin-phone-auth';
import axios, { AxiosInstance } from 'axios';

export interface SwiftSmsProviderOptions {
    baseUrl: string;
    username: string;
    password: string;
    orgCode: string;
}

/**
 * SMS provider that sends messages via the Swift SMS API.
 * Implements the SmsProvider interface from @rahul/vendure-plugin-phone-auth.
 *
 * Uses Basic Auth and sends SMS via a POST request.
 */
export class SwiftSmsProvider implements SmsProvider {
    private client: AxiosInstance;

    constructor(private options: SwiftSmsProviderOptions) {
        const basicAuthToken = Buffer.from(
            `${options.username}:${options.password}`,
        ).toString('base64');

        this.client = axios.create({
            baseURL: options.baseUrl,
            timeout: 10_000,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Basic ${basicAuthToken}`,
                OrganisationCode: options.orgCode,
            },
        });
    }

    async sendSms(_ctx: RequestContext, phoneNumber: string, message: string): Promise<void> {
        // Swift SMS expects phone numbers without the '+' prefix
        const receiverNo = phoneNumber.startsWith('+')
            ? phoneNumber.slice(1)
            : phoneNumber;

        const response = await this.client.post(this.options.baseUrl, {
            IsClientLogin: 'N',
            ReceiverNo: receiverNo,
            Message: message,
        });

        // Response code 100 = success
        if (response.data?.responseCode !== 100) {
            throw new Error(
                `Swift SMS failed: ${response.data?.responseDescription ?? 'Unknown error'}`,
            );
        }
    }
}
