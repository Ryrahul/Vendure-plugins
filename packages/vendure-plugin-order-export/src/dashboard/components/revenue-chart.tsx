import { Card, CardContent, CardHeader, CardTitle } from '@vendure/dashboard';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';

interface RevenueChartProps {
    data: Array<{ date: string; value: number }>;
    currencyCode?: string;
}

function formatMoney(value: number, currencyCode = 'USD') {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value / 100);
}

export function RevenueChart({ data, currencyCode }: RevenueChartProps) {
    const chartData = data.map((d) => ({
        date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        revenue: d.value,
    }));

    return (
        <Card>
            <CardHeader>
                <CardTitle>Revenue Over Time</CardTitle>
            </CardHeader>
            <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={chartData}>
                        <defs>
                            <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#4472C4" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#4472C4" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" fontSize={12} tickLine={false} />
                        <YAxis
                            fontSize={12}
                            tickLine={false}
                            tickFormatter={(v) => formatMoney(v, currencyCode)}
                        />
                        <Tooltip
                            formatter={(value: number) => [formatMoney(value, currencyCode), 'Revenue']}
                        />
                        <Area
                            type="monotone"
                            dataKey="revenue"
                            stroke="#4472C4"
                            fill="url(#revenueGradient)"
                            strokeWidth={2}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
}
