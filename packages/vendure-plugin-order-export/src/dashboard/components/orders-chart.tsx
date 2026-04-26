import { Card, CardContent, CardHeader, CardTitle } from '@vendure/dashboard';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';

interface OrdersChartProps {
    data: Array<{ date: string; value: number }>;
}

export function OrdersChart({ data }: OrdersChartProps) {
    const chartData = data.map((d) => ({
        date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        orders: d.value,
    }));

    return (
        <Card>
            <CardHeader>
                <CardTitle>Orders Over Time</CardTitle>
            </CardHeader>
            <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" fontSize={12} tickLine={false} />
                        <YAxis fontSize={12} tickLine={false} />
                        <Tooltip formatter={(value: number) => [value, 'Orders']} />
                        <Bar dataKey="orders" fill="#5B9BD5" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
}
