import {
    dummyPaymentHandler,
    DefaultJobQueuePlugin,
    DefaultSchedulerPlugin,
    LanguageCode,
    VendureConfig,
} from '@vendure/core';
import { defaultEmailHandlers, EmailPlugin, FileBasedTemplateLoader } from '@vendure/email-plugin';
import { AssetServerPlugin } from '@vendure/asset-server-plugin';
import { DashboardPlugin } from '@vendure/dashboard/plugin';
import { GraphiqlPlugin } from '@vendure/graphiql-plugin';
import { PhoneAuthPlugin, ConsoleSmsProvider } from '@rahul_vendure/vendure-plugin-phone-auth';
import { WishlistPlugin } from '@rahul_vendure/vendure-plugin-wishlist';
import { FaqPlugin } from '@rahul_vendure/vendure-plugin-faq';
import { ExtraPromotionsPlugin } from '@rahul_vendure/vendure-plugin-extra-promotions';
import { MeilisearchPlugin } from '@rahul_vendure/vendure-meilli-search';
import { SwiftSmsProvider } from './providers/swift-sms.provider';
import 'dotenv/config';
import path from 'path';

const IS_DEV = process.env.APP_ENV === 'dev';
const serverPort = +process.env.PORT! || 3000;

export const config: VendureConfig = {
    apiOptions: {
        port: serverPort,
        adminApiPath: 'admin-api',
        shopApiPath: 'shop-api',
        trustProxy: IS_DEV ? false : 1,
        // The following options are useful in development mode,
        // but are best turned off for production for security
        // reasons.
        ...(IS_DEV ? {
            adminApiDebug: true,
            shopApiDebug: true,
        } : {}),
    },
    authOptions: {
        tokenMethod: ['bearer', 'cookie'],
        superadminCredentials: {
            identifier: process.env.SUPERADMIN_USERNAME!,
            password: process.env.SUPERADMIN_PASSWORD!,
        },
        cookieOptions: {
          secret: process.env.COOKIE_SECRET,
        },
    },
    dbConnectionOptions: {
        type: 'postgres',
        synchronize: true,
        migrations: [path.join(__dirname, './migrations/*.+(js|ts)')],
        logging: false,
        database: process.env.DB_NAME,
        schema: process.env.DB_SCHEMA,
        host: process.env.DB_HOST,
        port: +String(process.env.DB_PORT),
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
    },
    paymentOptions: {
        paymentMethodHandlers: [dummyPaymentHandler],
    },
    customFields: {
        Product: [
            {
                name: 'brand',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Brand' }],
            },
        ],
        ProductVariant: [
            {
                name: 'weight',
                type: 'float',
                label: [{ languageCode: LanguageCode.en, value: 'Weight (kg)' }],
            },
        ],
    },
    plugins: [
        GraphiqlPlugin.init(),
        AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir: path.join(__dirname, '../static/assets'),
            // For local dev, the correct value for assetUrlPrefix should
            // be guessed correctly, but for production it will usually need
            // to be set manually to match your production url.
            assetUrlPrefix: IS_DEV ? undefined : 'https://www.my-shop.com/assets/',
        }),
        DefaultSchedulerPlugin.init(),
        DefaultJobQueuePlugin.init({ useDatabaseForBuffer: true }),
        MeilisearchPlugin.init({
            host: process.env.MEILISEARCH_HOST || 'http://localhost:7700',
            apiKey: process.env.MEILISEARCH_API_KEY || '',
            searchConfig: {
                // Balanced matching: drops only the least important term if needed
                matchingStrategy: 'frequency',
                // Filter out very weak results
                rankingScoreThreshold: 0.15,
                // Show ranking scores for dev debugging
                showRankingScore: true,
            },
            typoTolerance: {
                enabled: true,
                // 1 typo on words with 4+ chars (default 5)
                minWordSizeForOneTypo: 4,
                // 2 typos on words with 8+ chars (default 9)
                minWordSizeForTwoTypos: 8,
            },
            // ai: {
            //     embedders: {
            //         'default': {
            //             source: 'openAi',
            //             model: 'text-embedding-3-small',
            //             apiKey: process.env.OPENAI_API_KEY || '',
            //             documentTemplate: "A product called '{{doc.productName}}' - {{doc.description | truncatewords: 20}}",
            //         },
            //     },
            //     semanticRatio: 0.5,
            // },
            customProductMappings: {
                brand: {
                    graphQlType: 'String',
                    valueFn: (product) => (product.customFields as any)?.brand ?? '',
                },
            },
            customProductVariantMappings: {
                weight: {
                    graphQlType: 'Float',
                    valueFn: (variant) => (variant.customFields as any)?.weight ?? 0,
                },
            },
            synonyms: {
                phone: ['mobile', 'smartphone'],
            },
            stopWords: ['the', 'a', 'an'],
        }),
        EmailPlugin.init({
            devMode: true,
            outputPath: path.join(__dirname, '../static/email/test-emails'),
            route: 'mailbox',
            handlers: defaultEmailHandlers,
            templateLoader: new FileBasedTemplateLoader(path.join(__dirname, '../static/email/templates')),
            globalTemplateVars: {
                // The following variables will change depending on your storefront implementation.
                // Here we are assuming a storefront running at http://localhost:8080.
                fromAddress: '"example" <noreply@example.com>',
                verifyEmailAddressUrl: 'http://localhost:8080/verify',
                passwordResetUrl: 'http://localhost:8080/password-reset',
                changeEmailAddressUrl: 'http://localhost:8080/verify-email-address-change'
            },
        }),
        DashboardPlugin.init({
            route: 'dashboard',
            appDir: IS_DEV
                ? path.join(__dirname, '../dist/dashboard')
                : path.join(__dirname, 'dashboard'),
        }),
        PhoneAuthPlugin.init({
            smsProvider:
                 new SwiftSmsProvider({
                    baseUrl: process.env.SWIFT_SMS_BASE_URL!,
                    username: process.env.SWIFT_SMS_USERNAME!,
                    password: process.env.SWIFT_SMS_PASSWORD!,
                    orgCode: process.env.SWIFT_SMS_ORG_CODE!,
                }),
            devMode: false,
            syntheticEmailDomain: 'lodu-prasad',
            messageTemplate: 'Your heroo code is: {code}',
        }),
        WishlistPlugin.init(),
        FaqPlugin.init(),
        ExtraPromotionsPlugin,
   
    ],
};
