import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    api,
    Badge,
    Button,
    DashboardRouteDefinition,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    ListPage,
    PageActionBarRight,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
} from '@vendure/dashboard';
import { PlusIcon } from 'lucide-react';
import { toast } from 'sonner';

import {
    getReportSchedulesQuery,
    createReportScheduleMutation,
    toggleReportScheduleMutation,
} from './order-export.graphql';

export const scheduleList: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'order-analytics',
        id: 'schedule-list',
        url: '/report-schedules',
        title: 'Report Schedules',
    },
    path: '/report-schedules',
    loader: () => ({ breadcrumb: 'Report Schedules' }),
    component: (route) => <ScheduleListPage route={route} />,
};

function ScheduleListPage({ route }: { route: any }) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [name, setName] = useState('');
    const [frequency, setFrequency] = useState('DAILY');
    const [format, setFormat] = useState('CSV');
    const [emails, setEmails] = useState('');
    const [includeAi, setIncludeAi] = useState(false);
    const queryClient = useQueryClient();

    const { mutate: createSchedule, isPending } = useMutation({
        mutationFn: () =>
            api.mutate(createReportScheduleMutation, {
                input: {
                    name,
                    frequency: frequency as any,
                    exportFormat: format as any,
                    recipientEmails: emails.split(',').map((e) => e.trim()).filter(Boolean),
                    includeAiInsights: includeAi,
                },
            }),
        onSuccess: () => {
            toast.success('Report schedule created');
            queryClient.invalidateQueries();
            setDialogOpen(false);
            resetForm();
        },
        onError: (err: any) => {
            toast.error('Failed to create schedule', { description: err.message });
        },
    });

    const { mutate: toggle } = useMutation({
        mutationFn: (id: string) => api.mutate(toggleReportScheduleMutation, { id }),
        onSuccess: () => {
            queryClient.invalidateQueries();
        },
    });

    function resetForm() {
        setName('');
        setFrequency('DAILY');
        setFormat('CSV');
        setEmails('');
        setIncludeAi(false);
    }

    return (
        <>
            <ListPage
                pageId="report-schedule-list"
                title="Report Schedules"
                listQuery={getReportSchedulesQuery}
                route={route}
                defaultVisibility={{
                    id: false,
                    updatedAt: false,
                    filters: false,
                }}
                customizeColumns={{
                    enabled: {
                        cell: ({ row }) => {
                            const schedule = row.original;
                            return (
                                <Switch
                                    checked={schedule.enabled}
                                    onCheckedChange={() => toggle(schedule.id)}
                                />
                            );
                        },
                    },
                    frequency: {
                        cell: ({ row }) => {
                            const freq = row.original.frequency;
                            const colors: Record<string, string> = {
                                DAILY: 'bg-blue-100 text-blue-800',
                                WEEKLY: 'bg-green-100 text-green-800',
                                MONTHLY: 'bg-purple-100 text-purple-800',
                            };
                            return (
                                <Badge variant="outline" className={colors[freq] ?? ''}>
                                    {freq}
                                </Badge>
                            );
                        },
                    },
                    recipientEmails: {
                        cell: ({ row }) => {
                            const emails = row.original.recipientEmails;
                            return (
                                <span className="text-sm">
                                    {emails.join(', ')}
                                </span>
                            );
                        },
                    },
                    lastRunAt: {
                        cell: ({ row }) => {
                            const lastRun = row.original.lastRunAt;
                            if (!lastRun) return <span className="text-muted-foreground">Never</span>;
                            return (
                                <span>
                                    {new Date(lastRun).toLocaleString()}
                                </span>
                            );
                        },
                    },
                }}
            >
                <PageActionBarRight>
                    <Button onClick={() => setDialogOpen(true)}>
                        <PlusIcon className="mr-2 h-4 w-4" />
                        New Schedule
                    </Button>
                </PageActionBarRight>
            </ListPage>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Create Report Schedule</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label>Name</Label>
                            <Input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Daily Revenue Report"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Frequency</Label>
                                <Select value={frequency} onValueChange={setFrequency}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="DAILY">Daily</SelectItem>
                                        <SelectItem value="WEEKLY">Weekly</SelectItem>
                                        <SelectItem value="MONTHLY">Monthly</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label>Format</Label>
                                <Select value={format} onValueChange={setFormat}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="CSV">CSV</SelectItem>
                                        <SelectItem value="EXCEL">Excel</SelectItem>
                                        <SelectItem value="PDF">PDF</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label>Recipient Emails</Label>
                            <Input
                                value={emails}
                                onChange={(e) => setEmails(e.target.value)}
                                placeholder="email1@example.com, email2@example.com"
                            />
                            <p className="text-xs text-muted-foreground">
                                Comma-separated list of email addresses
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch checked={includeAi} onCheckedChange={setIncludeAi} />
                            <Label>Include AI insights</Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={() => createSchedule()}
                            disabled={isPending || !name || !emails}
                        >
                            {isPending ? 'Creating...' : 'Create Schedule'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
