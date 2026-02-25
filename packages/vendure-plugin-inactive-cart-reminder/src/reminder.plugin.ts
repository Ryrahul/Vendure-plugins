import { PluginCommonModule, VendurePlugin } from "@vendure/core";
import { InactiveCartReminderTask } from "./services/schedule.service";
import { InactiveCartReminderService } from "./services/reminder.service";
import { InactiveCartReminderOptions } from "./types";

@VendurePlugin({
  imports: [PluginCommonModule],
  providers: [InactiveCartReminderService],
  configuration: (config) => {
    config.schedulerOptions.tasks.push(
      InactiveCartReminderTask.configure({
        params: {
          batches: InactiveCartReminderPlugin.options.batchSize ?? 50,
          expiryTime:
            InactiveCartReminderPlugin.options.expiryTime ?? 604800000,
          before : InactiveCartReminderPlugin.options.before ,
          after : InactiveCartReminderPlugin.options.after ,
        },
        timeout: InactiveCartReminderPlugin.options.timeout ?? 120000,
      }),
    );

    return config;
  },

  compatibility: "^3.0.0",
})
export class InactiveCartReminderPlugin {
  static options: InactiveCartReminderOptions;

  static init(
    options?: InactiveCartReminderOptions,
  ): typeof InactiveCartReminderPlugin {
    this.options = {
      ...this.options,
      ...options,
    };
    return InactiveCartReminderPlugin;
  }
}
