import { Card, CardContent, CardHeader, CardTitle } from '@vendure/dashboard';

interface TopCustomersTableProps {
    data: Array<{
        customerId: string;
        customerName: string;
        customerEmail: string;
        totalSpent: number;
        orderCount: number;
    }>;
    currencyCode?: string;
}

function formatMoney(value: number, currencyCode = 'USD') {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 2,
    }).format(value / 100);
}

export function TopCustomersTable({ data, currencyCode }: TopCustomersTableProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Top Customers</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    {data.map((customer, index) => (
                        <div
                            key={customer.customerId}
                            className="flex items-center justify-between gap-2 border-b pb-2 last:border-0"
                        >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-100 text-xs font-bold text-purple-700">
                                    {index + 1}
                                </span>
                                <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">{customer.customerName}</p>
                                    <p className="text-xs text-muted-foreground truncate">
                                        {customer.customerEmail} &middot; {customer.orderCount} orders
                                    </p>
                                </div>
                            </div>
                            <span className="text-sm font-semibold whitespace-nowrap">
                                {formatMoney(customer.totalSpent, currencyCode)}
                            </span>
                        </div>
                    ))}
                    {data.length === 0 && (
                        <p className="text-center text-sm text-muted-foreground">No data</p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
