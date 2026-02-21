import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, BulkActionComponent, DataTableBulkActionItem } from '@vendure/dashboard';
import { Trash2, FolderMinus, FolderInput } from 'lucide-react';
import { toast } from 'sonner';
import {
    deleteFaqMutation,
    assignFaqsToChannelsMutation,
    removeFaqsFromCurrentChannelMutation,
} from '../faq.graphql';
import { ChannelAssignmentModal } from './channel-assignment-modal';

export const DeleteFaqBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    const queryClient = useQueryClient();
    const { mutateAsync: deleteFaq } = useMutation({
        mutationFn: (ids: string[]) => {
            return api.mutate(deleteFaqMutation, { ids });
        },
    });

    const handleDelete = async () => {
        try {
            const result = await deleteFaq(selection.map((item) => item.id));

            if (result.deleteFaq.result === 'DELETED') {
                toast.success(result.deleteFaq.message);
                await queryClient.invalidateQueries();
                table.resetRowSelection();
            } else {
                toast.error('Failed to delete FAQs');
            }
        } catch (error) {
            toast.error('Error deleting FAQs', {
                description: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    };

    return (
        <DataTableBulkActionItem
            onClick={handleDelete}
            label="Delete"
            confirmationText={`Are you sure you want to delete ${selection.length} FAQ(s)?`}
            icon={Trash2}
            className="text-destructive"
            requiresPermission={['DeleteFaq']}
        />
    );
};

export const RemoveFaqsFromChannelBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    const queryClient = useQueryClient();
    const { mutateAsync: removeFaqsFromChannel } = useMutation({
        mutationFn: (faqIds: string[]) => {
            return api.mutate(removeFaqsFromCurrentChannelMutation, { faqIds });
        },
    });

    const handleRemove = async () => {
        try {
            await removeFaqsFromChannel(selection.map((item) => item.id));

            toast.success(`Successfully removed ${selection.length} FAQ(s) from current channel`);
            await queryClient.invalidateQueries();
            table.resetRowSelection();
        } catch (error) {
            toast.error('Failed to remove FAQs from channel', {
                description: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    };

    return (
        <DataTableBulkActionItem
            onClick={handleRemove}
            label="Remove from channel"
            confirmationText={`Are you sure you want to remove ${selection.length} FAQ(s) from the current channel?`}
            icon={FolderMinus}
            className="text-destructive"
            requiresPermission={['UpdateFaq']}
        />
    );
};

export const AssignFaqsToChannelBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    const [modalOpen, setModalOpen] = useState(false);
    const queryClient = useQueryClient();
    const { mutateAsync: assignFaqsToChannels } = useMutation({
        mutationFn: (input: { faqIds: string[]; channelIds: string[] }) => {
            return api.mutate(assignFaqsToChannelsMutation, { input });
        },
    });

    const handleAssign = () => {
        setModalOpen(true);
    };

    const handleConfirm = async (channelIds: string[]) => {
        try {
            await assignFaqsToChannels({
                faqIds: selection.map((item) => item.id),
                channelIds,
            });

            toast.success(
                `Successfully assigned ${selection.length} FAQ(s) to ${channelIds.length} channel(s)`,
            );
            await queryClient.invalidateQueries();
            table.resetRowSelection();
            setModalOpen(false);
        } catch (error) {
            toast.error('Failed to assign FAQs to channels', {
                description: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    };

    return (
        <>
            <DataTableBulkActionItem
                onClick={handleAssign}
                label="Assign to channels"
                icon={FolderInput}
                requiresPermission={['UpdateFaq']}
            />
            <ChannelAssignmentModal
                open={modalOpen}
                onOpenChange={setModalOpen}
                onConfirm={handleConfirm}
                selectedCount={selection.length}
            />
        </>
    );
};
