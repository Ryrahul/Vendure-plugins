import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    api,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Checkbox,
    Label,
} from '@vendure/dashboard';
import { Loader2 } from 'lucide-react';
import { getChannelsQuery } from '../faq.graphql';

interface ChannelAssignmentModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (channelIds: string[]) => void;
    selectedCount: number;
}

export function ChannelAssignmentModal({
    open,
    onOpenChange,
    onConfirm,
    selectedCount,
}: ChannelAssignmentModalProps) {
    const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());

    const { data, isLoading } = useQuery({
        queryKey: ['channels'],
        queryFn: () => api.query(getChannelsQuery, {}),
        enabled: open,
    });

    const channels = (data?.channels?.items ?? []).filter(
        (channel) => channel.code !== '__default_channel__',
    );

    const toggleChannel = (channelId: string) => {
        setSelectedChannels((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(channelId)) {
                newSet.delete(channelId);
            } else {
                newSet.add(channelId);
            }
            return newSet;
        });
    };

    const handleConfirm = () => {
        onConfirm(Array.from(selectedChannels));
        setSelectedChannels(new Set());
    };

    const handleCancel = () => {
        onOpenChange(false);
        setSelectedChannels(new Set());
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Assign FAQs to Channels</DialogTitle>
                    <DialogDescription>
                        Select the channels you want to assign {selectedCount} FAQ(s) to.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin" />
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {channels.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No channels available</p>
                            ) : (
                                channels.map((channel) => (
                                    <div key={channel.id} className="flex items-center space-x-2">
                                        <Checkbox
                                            id={`channel-${channel.id}`}
                                            checked={selectedChannels.has(channel.id)}
                                            onCheckedChange={() => toggleChannel(channel.id)}
                                        />
                                        <Label
                                            htmlFor={`channel-${channel.id}`}
                                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                                        >
                                            {channel.code}
                                        </Label>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleCancel}>
                        Cancel
                    </Button>
                    <Button onClick={handleConfirm} disabled={selectedChannels.size === 0 || isLoading}>
                        Assign{selectedChannels.size > 0 ? ` to ${selectedChannels.size}` : ''}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
