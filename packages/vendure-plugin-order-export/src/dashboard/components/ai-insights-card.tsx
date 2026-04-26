import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, Button, Card, CardContent, CardHeader, CardTitle } from '@vendure/dashboard';
import { BrainCircuit, Loader2 } from 'lucide-react';
import Markdown from 'react-markdown';

import { generateAiInsightQuery } from '../order-export.graphql';

interface AiInsightsCardProps {
    startDate: string;
    endDate: string;
}

export function AiInsightsCard({ startDate, endDate }: AiInsightsCardProps) {
    const [insight, setInsight] = useState<string | null>(null);

    const { mutate: generate, isPending } = useMutation({
        mutationFn: async () => {
            const result = await api.query(generateAiInsightQuery, {
                input: {
                    startDate,
                    endDate,
                },
            });
            return result.generateAiInsight;
        },
        onSuccess: (data) => {
            setInsight(data ?? 'No insight generated.');
        },
        onError: (error: any) => {
            setInsight(`Failed to generate insight: ${error.message}`);
        },
    });

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                    <BrainCircuit className="h-5 w-5 text-purple-600" />
                    AI Insights
                </CardTitle>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => generate()}
                    disabled={isPending}
                >
                    {isPending ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Analyzing...
                        </>
                    ) : (
                        'Generate Insight'
                    )}
                </Button>
            </CardHeader>
            <CardContent>
                {insight ? (
                    <div className="prose prose-sm max-w-none text-muted-foreground [&_h1]:text-foreground [&_h2]:text-foreground [&_h3]:text-foreground [&_strong]:text-foreground [&_h2]:text-base [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:mt-4 [&_h3]:mb-1 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_p]:my-2">
                        <Markdown>{insight}</Markdown>
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        Click "Generate Insight" to get an AI-powered analysis of your order data for
                        the selected period.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
