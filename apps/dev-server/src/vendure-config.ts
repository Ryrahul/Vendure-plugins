import {
  dummyPaymentHandler,
  DefaultJobQueuePlugin,
  DefaultSchedulerPlugin,
  DefaultSearchPlugin,
  VendureConfig,
} from "@vendure/core";
import {
  defaultEmailHandlers,
  EmailPlugin,
  FileBasedTemplateLoader,
} from "@vendure/email-plugin";
import { AssetServerPlugin } from "@vendure/asset-server-plugin";
import { DashboardPlugin } from "@vendure/dashboard/plugin";
import { GraphiqlPlugin } from "@vendure/graphiql-plugin";
// import {
//   PhoneAuthPlugin,
//   ConsoleSmsProvider,
// } from "@rahul_vendure/vendure-plugin-phone-auth";
// import { WishlistPlugin } from "@rahul_vendure/vendure-plugin-wishlist";
// import { FaqPlugin } from "@rahul_vendure/vendure-plugin-faq";
import { SwiftSmsProvider } from "./providers/swift-sms.provider";
import "dotenv/config";
import path from "path";
import {
  InactiveCartReminderPlugin,
  InactiveCartReminderHandler,
} from "@rahul_vendure/vendure-plugin-inactive-cart-reminder";

const IS_DEV = process.env.APP_ENV === "dev";
const serverPort = +process.env.PORT! || 3000;

export const config: VendureConfig = {
  apiOptions: {
    port: serverPort,
    adminApiPath: "admin-api",
    shopApiPath: "shop-api",
    trustProxy: IS_DEV ? false : 1,
    // The following options are useful in development mode,
    // but are best turned off for production for security
    // reasons.
    ...(IS_DEV
      ? {
          adminApiDebug: true,
          shopApiDebug: true,
        }
      : {}),
  },
  authOptions: {
    tokenMethod: ["bearer", "cookie"],
    superadminCredentials: {
      identifier: process.env.SUPERADMIN_USERNAME!,
      password: process.env.SUPERADMIN_PASSWORD!,
    },
    cookieOptions: {
      secret: process.env.COOKIE_SECRET,
    },
  },
  dbConnectionOptions: {
    type: "postgres",
    synchronize: true,
    migrations: [path.join(__dirname, "./migrations/*.+(js|ts)")],
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
  // When adding or altering custom field definitions, the database will
  // need to be updated. See the "Migrations" section in README.md.
  customFields: {},
  plugins: [
    GraphiqlPlugin.init(),
    AssetServerPlugin.init({
      route: "assets",
      assetUploadDir: path.join(__dirname, "../static/assets"),
      // For local dev, the correct value for assetUrlPrefix should
      // be guessed correctly, but for production it will usually need
      // to be set manually to match your production url.
      assetUrlPrefix: IS_DEV ? undefined : "https://www.my-shop.com/assets/",
    }),

    DefaultJobQueuePlugin.init({ useDatabaseForBuffer: true }),
    DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }),
    EmailPlugin.init({
      devMode: true,
      outputPath: path.join(__dirname, "../static/email/test-emails"),
      route: "mailbox",
      handlers: [...defaultEmailHandlers, InactiveCartReminderHandler],
      templateLoader: new FileBasedTemplateLoader(
        path.join(__dirname, "../static/email/templates"),
      ),
      globalTemplateVars: {
        // The following variables will change depending on your storefront implementation.
        // Here we are assuming a storefront running at http://localhost:8080.
        fromAddress: "mail@mail.com",
        verifyEmailAddressUrl: "http://localhost:8080/verify",
        passwordResetUrl: "http://localhost:8080/password-reset",
        changeEmailAddressUrl:
          "http://localhost:8080/verify-email-address-change",
      },
    }),
    DefaultSchedulerPlugin.init(),
    DashboardPlugin.init({
      route: "dashboard",
      appDir: IS_DEV
        ? path.join(__dirname, "../dist/dashboard")
        : path.join(__dirname, "dashboard"),
    }),
    // PhoneAuthPlugin.init({
    //   smsProvider: new SwiftSmsProvider({
    //     baseUrl: process.env.SWIFT_SMS_BASE_URL!,
    //     username: process.env.SWIFT_SMS_USERNAME!,
    //     password: process.env.SWIFT_SMS_PASSWORD!,
    //     orgCode: process.env.SWIFT_SMS_ORG_CODE!,
    //   }),
    //   devMode: false,
    // }),
    // WishlistPlugin.init(),
    // FaqPlugin.init(),
    InactiveCartReminderPlugin.init({
      before: 72,
      after: 0,
      fromAddress: "ayus@mail.om",
      // scheduleTime: {
      //   hour: new Date().getHours(),
      //   minutes: new Date().getMinutes() + 2,
      // },
      shopUrl: "https://github.com" ,
      expiryTime: 60 * 60 * 1000,
      batchSize: 20,
    }),
  ],
};
