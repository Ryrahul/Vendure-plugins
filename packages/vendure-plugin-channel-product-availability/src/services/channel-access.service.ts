import { Injectable } from '@nestjs/common';
import { ForbiddenError, ID, Permission, RequestContext } from '@vendure/core';

export const READ_PERMISSIONS = [Permission.ReadCatalog, Permission.ReadProduct];
export const UPDATE_PERMISSIONS = [Permission.UpdateCatalog, Permission.UpdateProduct];

/**
 * Authorizes access to a channel other than the active one.
 *
 * `@Allow()` only checks permissions in the active channel (the `vendure-token`).
 * A `channelId` argument must be checked against the session's per-channel
 * permissions, otherwise an admin of channel A could change channel B.
 */
@Injectable()
export class ChannelAccessService {
    hasPermissionInChannel(ctx: RequestContext, channelId: ID, permissions: Permission[]): boolean {
        const user = ctx.session?.user;
        if (!user) {
            return false;
        }
        const channel = user.channelPermissions.find(c => String(c.id) === String(channelId));
        return !!channel && permissions.some(p => channel.permissions.includes(p));
    }

    assertPermissionInChannel(ctx: RequestContext, channelId: ID, permissions: Permission[]): void {
        if (!this.hasPermissionInChannel(ctx, channelId, permissions)) {
            throw new ForbiddenError();
        }
    }

    channelIdsWithPermission(ctx: RequestContext, permissions: Permission[]): string[] {
        return (ctx.session?.user?.channelPermissions ?? [])
            .filter(c => permissions.some(p => c.permissions.includes(p)))
            .map(c => String(c.id));
    }
}
