import { Card, CardContent, CardHeader, CardTitle } from '@vendure/dashboard';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface CategoryBreakdownProps {
    data: Array<{
        category: string;
        revenue: number;
        percentage: number;
    }>;
    currencyCode?: string;
}

const COLORS = [
    '#4472C4',
    '#ED7D31',
    '#A5A5A5',
    '#FFC000',
    '#5B9BD5',
    '#70AD47',
    '#264478',
    '#9B59B6',
];

function formatMoney(value: number, currencyCode = 'USD') {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 0,
    }).format(value / 100);
}

export function CategoryBreakdown({ data, currencyCode }: CategoryBreakdownProps) {
    const chartData = data.map((item) => ({
        name: item.category,
        value: item.revenue,
        percentage: item.percentage,
    }));

    return (
        <Card>
            <CardHeader>
                <CardTitle>Revenue by Collection</CardTitle>
            </CardHeader>
            <CardContent>
                {chartData.length > 0 ? (
                    <div className="flex flex-col lg:flex-row items-center gap-4">
                        <ResponsiveContainer width="100%" height={280}>
                            <PieChart>
                                <Pie
                                    data={chartData}
                                    dataKey="value"
                                    nameKey="name"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={110}
                                    label={false}
                                >
                                    {chartData.map((_entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={COLORS[index % COLORS.length]}
                                        />
                                    ))}
                                </Pie>
                                <Tooltip
                                    formatter={(value: number, name: string) => [
                                        formatMoney(value, currencyCode),
                                        name,
                                    ]}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="flex flex-col gap-2 min-w-[200px]">
                            {chartData.map((item, index) => (
                                <div key={item.name} className="flex items-center gap-2 text-sm">
                                    <span
                                        className="w-3 h-3 rounded-full shrink-0"
                                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                    />
                                    <span className="truncate flex-1">{item.name}</span>
                                    <span className="text-muted-foreground whitespace-nowrap">
                                        {item.percentage}%
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <p className="text-center text-sm text-muted-foreground py-8">No data</p>
                )}
            </CardContent>
        </Card>
    );
}
