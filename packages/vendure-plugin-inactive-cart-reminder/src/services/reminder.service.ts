import { Injectable } from "@nestjs/common";
import {
  ID,
  Order,
  RequestContext,
  TransactionalConnection,
} from "@vendure/core";

@Injectable()
export class InactiveCartReminderService {
  constructor(private connection: TransactionalConnection) {}

  async getInactiveCartRecipients(
    ctx: RequestContext,
    before: number = 72,
    after: number = 24,
    batchSize: number,
    cursor: ID | undefined,
  ) {
    const olderThan = new Date();

    olderThan.setHours(olderThan.getHours() - before);

    const newerThan = new Date();
    newerThan.setHours(newerThan.getHours() - after);
    console.log("=== InactiveCartReminder Debug ===");
    console.log("beforeHour:", before, "→", olderThan);
    console.log("afterHour:", after, "→", newerThan);
    console.log("cursor:", cursor);

    const limit = batchSize + 1;

    let qb = this.connection
      .getRepository(ctx, Order)
      .createQueryBuilder("order")
      .innerJoinAndSelect("order.customer", "customer")
      .innerJoinAndSelect("order.lines", "lines")
      .leftJoinAndSelect("lines.productVariant", "productVariant")
      .leftJoinAndSelect("productVariant.translations", "variantTranslation")
      .where("order.state = :state", { state: "Draft" })
      .andWhere("order.updatedAt < :olderThan", { olderThan })
      .andWhere("customer.deletedAt IS NULL")
      .andWhere("customer.emailAddress IS NOT NULL")
      .orderBy("order.id", "ASC")
      .take(limit);

    if (after > 0) {
      const newerThan = new Date();
      newerThan.setHours(newerThan.getHours() - after);
      qb = qb.andWhere("order.updatedAt > :newerThan", { newerThan });
    }
    if (cursor) {
      qb = qb.andWhere("order.id > :cursor", { cursor });
    }
    const orders = await qb.getMany();
    const hasNextPage = orders.length > batchSize;
    const pageOrders = hasNextPage ? orders.slice(0, batchSize) : orders;
    const response = new Map<
      string,
      {
        customerName: string;
        email: string;
        customerId: ID;
        orderId: ID;
        orderItems: string[];
      }
    >();

    for (const order of pageOrders) {
      if (!order.customer?.emailAddress) continue;

      const orderItems = order.lines
        .map(
          (line) =>
            line.productVariant?.translations.find(
              (t) => t.languageCode === ctx.languageCode,
            )?.name,
        )
        .filter((name) => typeof name === "string");

      if (orderItems.length > 1) continue;

      response.set(order.customer.emailAddress, {
        customerName:
          `${order.customer.firstName ?? ""} ${order.customer.lastName ?? ""}`.trim(),
        email: order.customer.emailAddress,
        customerId: order.customer.id,
        orderId: order.id,
        orderItems,
      });
    }
    const recipients = Array.from(response.values());
    const nextCursor = hasNextPage
      ? pageOrders[pageOrders.length - 1].id
      : null;
    console.log("recipients:", recipients);

    return { recipients, nextCursor, hasNextPage };
  }
}
