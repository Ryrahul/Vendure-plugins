export interface InactiveCartReminderOptions {
  before: number;
  after: number;
  batchSize?: number;
  expiryTime?: number;
  scheduleTime?: { hour: number; minutes: number };
  shopUrl?: string;
  fromAddress?: string;
  timeout?: number;
}
