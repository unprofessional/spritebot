import { Client, Events } from 'discord.js';

import { supportGuildId } from '../config/env_config';
import { isDrainInProgressError, isDraining, trackOperation } from '../runtime/lifecycle';
import { verifySupportMember } from '../services/support_verification.service';

export function initializeSupportVerificationEvents(client: Client): void {
  client.on(Events.GuildMemberAdd, (member) => {
    if (member.guild.id !== supportGuildId) return;

    void (async () => {
      if (isDraining()) return;
      try {
        await trackOperation('guild-member:support-verification', () =>
          verifySupportMember(member),
        );
      } catch (err) {
        if (isDrainInProgressError(err)) return;
        console.error('[support_verification] Failed to verify joining member:', err);
      }
    })();
  });
}
