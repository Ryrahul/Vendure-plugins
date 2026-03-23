import { CacheService, EventBus, ID, ScheduledTask } from "@vendure/core";
import { InactiveCartReminderService } from "./reminder.service";
import { InactiveCartReminderEvent } from "../event";

export const InactiveCartReminderTask = new ScheduledTask({
  id: "inactive-cart-reminder",
  params: {
    batches: 50,
    expiryTime: 604800000,
    before: 24,
    after: 0,
  },
  schedule: (cron) => cron.everyMinute(),
  timeout: 120000,
  preventOverlap: true,
  execute: async ({ injector, scheduledContext, params }) => {
    console.log("Task fired with params:", params);
    const inactiveCartService = injector.get(InactiveCartReminderService);
    const eventBus = injector.get(EventBus);
    const cacheService = injector.get(CacheService);

    let totalSent = 0;
    let cursor: ID | undefined = undefined;
    let hasNextPage = true;
    // console.log(
    //   params.batches,
    //   params.afterHour,
    //   params.beforeHour,
    //   params.expiryTime,
    // );
    while (hasNextPage) {
      const {
        recipients,
        nextCursor,
        hasNextPage: nextPage,
      } = await inactiveCartService.getInactiveCartRecipients(
        scheduledContext,
        params.before,
        params.after,
        params.batches,
        cursor,
      );

      hasNextPage = nextPage;
      cursor = nextCursor ?? undefined;

      for (const recipient of recipients) {
        try {
          const cachekey = `InactiveCartReminder.sent:orderId:${recipient.orderId}`;
          const alreadySent = await cacheService.get(cachekey);

          if (alreadySent) continue;
          await eventBus.publish(
            new InactiveCartReminderEvent(scheduledContext, recipient),
          );
          await cacheService.set(cachekey, true, { ttl: params.expiryTime });
          totalSent++;
        } catch (error) {
          console.error(`Failed for order ${recipient.orderId}:`, error);
        }
      }
    }

    return { totalSent };
  },
});
