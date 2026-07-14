import { Client, Events } from 'discord.js';

import { isDrainInProgressError, isDraining, trackOperation } from '../runtime/lifecycle';
import { handleRoleplayProxyMessage } from '../services/rp_message_proxy.service';

export function initializeRoleplayProxy(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    void (async () => {
      if (isDraining()) return;
      try {
        await trackOperation('message:rp-proxy', () => handleRoleplayProxyMessage(message));
      } catch (err) {
        if (isDrainInProgressError(err)) return;
        console.error('[rp_proxy_events] Failed to process RP proxy message:', err);
      }
    })();
  });
}
