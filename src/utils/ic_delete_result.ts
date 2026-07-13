import { deleteRoleplayProxyMessage } from '../services/rp_message_proxy.service';

export function resultMessage(status: string, reason?: string): string {
  if (status === 'deleted') return '🗑️ Deleted your proxied RP message.';
  if (status === 'forbidden') return '⛔ You can only delete your own proxied RP messages.';
  if (status === 'not_found') {
    return '⚠️ I could not find a tracked proxied RP message for that ID or link.';
  }
  if (status === 'failed' && reason === 'webhook_not_found') {
    return '⚠️ I could not find the webhook that created that proxied message.';
  }
  if (status === 'failed' && reason === 'channel_cannot_webhook') {
    return '⚠️ That channel cannot be managed through RP webhooks.';
  }

  return '❌ Failed to delete that proxied RP message.';
}

export function resultReason(result: Awaited<ReturnType<typeof deleteRoleplayProxyMessage>>) {
  return 'reason' in result ? result.reason : undefined;
}
