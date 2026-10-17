import { LanguageCode, PaymentMethodHandler } from '@vendure/core';

export const testPaymentHandler = new PaymentMethodHandler({
    code: 'test-payment',
    description: [{ languageCode: LanguageCode.en, value: 'Test payment' }],
    args: {},
    createPayment: (ctx, order, amount) => ({ amount, state: 'Settled', transactionId: `tx-${order.code}` }),
    settlePayment: () => ({ success: true }),
});
