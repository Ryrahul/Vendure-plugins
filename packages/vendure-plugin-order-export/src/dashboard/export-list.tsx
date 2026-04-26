import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
    api,
    Button,
    DashboardRouteDefinition,
    ListPage,
    PageActionBarRight,
    Badge,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@vendure/dashboard';
import { Download, PlusIcon } from 'lucide-react';
import { toast } from 'sonner';

import {
    getExportReportsQuery,
    createExportReportMutation,
    deleteExportReportMutation,
} from './order-export.graphql';

export const exportList: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'order-analytics',
        id: 'export-list',
        url: '/export-reports',
        title: 'Export Reports',
    },
    path: '/export-reports',
    loader: () => ({ breadcrumb: 'Export Reports' }),
    component: (route) => <ExportListPage route={route} />,
};

function ExportListPage({ route }: { route: any }) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [exportFormat, setExportFormat] = useState('CSV');
    const queryClient = useQueryClient();

    const { mutate: createExport, isPending } = useMutation({
        mutationFn: (format: string) =>
            api.mutate(createExportReportMutation, {
                input: { type: format as any },
            }),
        onSuccess: () => {
            toast.success('Export started — it will appear in the list shortly.');
            queryClient.invalidateQueries();
            setDialogOpen(false);
        },
        onError: (err: any) => {
            toast.error('Failed to create export', { description: err.message });
        },
    });

    const statusColors: Record<string, string> = {
        PENDING: 'bg-yellow-100 text-yellow-800',
        PROCESSING: 'bg-blue-100 text-blue-800',
        COMPLETED: 'bg-green-100 text-green-800',
        FAILED: 'bg-red-100 text-red-800',
    };

    return (
        <>
            <ListPage
                pageId="export-report-list"
                title="Export Reports"
                listQuery={getExportReportsQuery}
                route={route}
                defaultVisibility={{
                    id: false,
                    updatedAt: false,
                    filters: false,
                    error: false,
                    aiInsight: false,
                }}
                customizeColumns={{
                    status: {
                        cell: ({ row }) => {
                            const status = row.original.status;
                            return (
                                <Badge
                                    variant="outline"
                                    className={statusColors[status] ?? ''}
                                >
                                    {status}
                                </Badge>
                            );
                        },
                    },
                    fileName: {
                        cell: ({ row }) => {
                            const report = row.original;
                            if (report.status === 'COMPLETED') {
                                return (
                                    <a
                                        href={`/order-export/download/${report.id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1 text-blue-600 hover:underline"
                                    >
                                        <Download className="h-3 w-3" />
                                        {report.fileName}
                                    </a>
                                );
                            }
                            return <span>{report.fileName}</span>;
                        },
                    },
                }}
            >
                <PageActionBarRight>
                    <Button onClick={() => setDialogOpen(true)}>
                        <PlusIcon className="mr-2 h-4 w-4" />
                        New Export
                    </Button>
                </PageActionBarRight>
            </ListPage>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create Export Report</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label>Format</Label>
                            <Select value={exportFormat} onValueChange={setExportFormat}>
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
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={() => createExport(exportFormat)}
                            disabled={isPending}
                        >
                            {isPending ? 'Creating...' : 'Create Export'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
