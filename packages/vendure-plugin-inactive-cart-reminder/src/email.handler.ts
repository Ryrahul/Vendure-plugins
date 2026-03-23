import { InactiveCartReminderEvent } from "./event";
import { InactiveCartReminderPlugin } from "./reminder.plugin";
import { EmailEventListener } from "@vendure/email-plugin";

export const InactiveCartReminderHandler = new EmailEventListener(
  "inactive-cart-reminder",
)
  .on(InactiveCartReminderEvent)

  .setRecipient((event: InactiveCartReminderEvent) => event.input.email)
  .setTemplateVars((event: InactiveCartReminderEvent) => ({
    orderItems: event.input.orderItems,
    orderId: event.input.orderId,
    customerName: event.input.customerName,
    date: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    shopUrl: InactiveCartReminderPlugin.options.shopUrl,
  }))
  .setFrom("ayus@mail.com")
  .setSubject("You left something in your cart!");
