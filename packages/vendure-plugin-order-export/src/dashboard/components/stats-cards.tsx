import { Card, CardContent, CardHeader, CardTitle } from '@vendure/dashboard';
import { DollarSign, ShoppingCart, TrendingUp, Users } from 'lucide-react';

interface StatsCardsProps {
    totalRevenue: number;
    totalOrders: number;
    averageOrderValue: number;
    repeatCustomerRate: number;
    currencyCode?: string;
}

function formatMoney(value: number, currencyCode = 'USD') {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 2,
    }).format(value / 100);
}

export function StatsCards({
    totalRevenue,
    totalOrders,
    averageOrderValue,
    repeatCustomerRate,
    currencyCode,
}: StatsCardsProps) {
    const cards = [
        {
            title: 'Total Revenue',
            value: formatMoney(totalRevenue, currencyCode),
            icon: DollarSign,
            color: 'text-green-600',
        },
        {
            title: 'Total Orders',
            value: totalOrders.toLocaleString(),
            icon: ShoppingCart,
            color: 'text-blue-600',
        },
        {
            title: 'Avg Order Value',
            value: formatMoney(averageOrderValue, currencyCode),
            icon: TrendingUp,
            color: 'text-purple-600',
        },
        {
            title: 'Repeat Customers',
            value: `${(repeatCustomerRate * 100).toFixed(1)}%`,
            icon: Users,
            color: 'text-orange-600',
        },
    ];

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((card) => (
                <Card key={card.title}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                        <card.icon className={`h-4 w-4 ${card.color}`} />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{card.value}</div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
