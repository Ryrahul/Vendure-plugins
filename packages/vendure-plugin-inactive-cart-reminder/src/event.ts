import { ID, RequestContext, VendureEvent } from "@vendure/core";

export class InactiveCartReminderEvent extends VendureEvent {
  constructor(
    public readonly ctx: RequestContext,
    public readonly input: {
      customerName: string;
      email: string;
      customerId: ID;
      orderId: ID;
      orderItems: string[];
    },
  ) {
    super();
  }
}
