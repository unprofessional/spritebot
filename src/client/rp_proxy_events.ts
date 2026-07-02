import { Client, Events } from 'discord.js';

import { handleRoleplayProxyMessage } from '../services/rp_message_proxy.service';

export function initializeRoleplayProxy(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    void (async () => {
      try {
        await handleRoleplayProxyMessage(message);
      } catch (err) {
        console.error('[rp_proxy_events] Failed to process RP proxy message:', err);
      }
    })();
  });
}
