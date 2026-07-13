import { Client, Events } from 'discord.js';

import { supportGuildId } from '../config/env_config';
import { verifySupportMember } from '../services/support_verification.service';

export function initializeSupportVerificationEvents(client: Client): void {
  client.on(Events.GuildMemberAdd, (member) => {
    if (member.guild.id !== supportGuildId) return;

    void (async () => {
      try {
        await verifySupportMember(member);
      } catch (err) {
        console.error('[support_verification] Failed to verify joining member:', err);
      }
    })();
  });
}
