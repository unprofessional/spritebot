// src/commands/bump-thread.ts

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  CacheType,
  ChannelType,
  PermissionFlagsBits,
  ThreadChannel,
} from 'discord.js';

import { ThreadBumpService } from '../services/thread_bump.service';
import { rescheduleThread, unscheduleThread } from '../schedulers/bump_scheduler';

const service = new ThreadBumpService();

function ensureGuild(interaction: ChatInputCommandInteraction<CacheType>): string {
  const gid = interaction.guild?.id;
  if (!gid) throw new Error('This command must be used in a server.');
  return gid;
}

function hasThreadPerms(interaction: ChatInputCommandInteraction<CacheType>): boolean {
  // Check the invoking user's permissions (not the bot's)
  const userPerms = interaction.memberPermissions;
  return Boolean(
    userPerms?.has(PermissionFlagsBits.ManageThreads) ||
      userPerms?.has(PermissionFlagsBits.Administrator),
  );
}

function resolveTargetThread(
  interaction: ChatInputCommandInteraction<CacheType>,
): ThreadChannel | null {
  // Optional channel option; otherwise fallback to current channel if it's a thread
  const opt = interaction.options.getChannel('thread', false);
  if (
    opt &&
    opt.type !== ChannelType.PublicThread &&
    opt.type !== ChannelType.PrivateThread &&
    opt.type !== ChannelType.AnnouncementThread
  ) {
    return null;
  }
  const channel = opt ?? interaction.channel;
  if (
    channel &&
    'isThread' in channel &&
    typeof (channel as ThreadChannel).isThread === 'function' &&
    (channel as ThreadChannel).isThread()
  ) {
    return channel as ThreadChannel;
  }
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bump-thread')
    .setDescription('Manage auto-bumps for threads in this server.')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Register a thread for auto-bumps (defaults to weekly).')
        .addChannelOption((o) =>
          o
            .setName('thread')
            .setDescription('Thread to register (defaults to current thread)')
            .addChannelTypes(
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread,
            ),
        )
        .addStringOption((o) =>
          o.setName('note').setDescription('Optional note to include in the bump message'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Unregister a thread from auto-bumps.')
        .addChannelOption((o) =>
          o
            .setName('thread')
            .setDescription('Thread to unregister (defaults to current thread)')
            .addChannelTypes(
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread,
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('set-note')
        .setDescription('Set or clear the bump note for a registered thread.')
        .addChannelOption((o) =>
          o
            .setName('thread')
            .setDescription('Target thread (defaults to current thread)')
            .addChannelTypes(
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread,
            ),
        )
        .addStringOption((o) =>
          o
            .setName('note')
            .setDescription('Note to set; leave empty to clear')
            .setMinLength(0)
            .setMaxLength(500),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List all registered bump threads in this server.'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('bump-now')
        .setDescription('Send a bump message immediately (for testing).')
        .addChannelOption((o) =>
          o
            .setName('thread')
            .setDescription('Thread to bump now (defaults to current thread)')
            .addChannelTypes(
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread,
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('set-interval')
        .setDescription('Set the auto-bump interval for a thread.')
        .addIntegerOption((o) =>
          o
            .setName('minutes')
            .setDescription('Minutes between bumps (e.g., 1440 = daily, 10080 = weekly)')
            .setMinValue(10)
            .setRequired(true),
        )
        .addChannelOption((o) =>
          o
            .setName('thread')
            .setDescription('Target thread (defaults to current thread)')
            .addChannelTypes(
              ChannelType.PublicThread,
              ChannelType.PrivateThread,
              ChannelType.AnnouncementThread,
            ),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction<CacheType>) {
    try {
      const sub = interaction.options.getSubcommand(true);
      const guildId = ensureGuild(interaction);

      if (!hasThreadPerms(interaction)) {
        await interaction.reply({
          content: '❌ You need **Manage Threads** to do that.',
          ephemeral: true,
        });
        return;
      }

      if (sub === 'list') {
        const rows = await service.listGuild(guildId);
        if (rows.length === 0) {
          await interaction.reply({
            content: 'ℹ️ No registered threads in this server.',
            ephemeral: true,
          });
          return;
        }
        const lines = rows
          .map((r) => {
            const due = service.nextDueAt(r);
            const ts = `<t:${Math.floor(due.getTime() / 1000)}:R>`; // relative time
            return `• <#${r.thread_id}> — every **${r.interval_minutes}m** — next ${ts}${
              r.note ? ` — _${r.note}_` : ''
            }`;
          })
          .join('\n');

        await interaction.reply({
          content: `📋 **Registered bump threads:**\n${lines}`,
          ephemeral: true,
        });
        return;
      }

      const target = resolveTargetThread(interaction);
      if (!target) {
        await interaction.reply({
          content:
            '⚠️ You must run this in a thread or specify a valid thread with `/bump-thread … thread:`.',
          ephemeral: true,
        });
        return;
      }

      // Safety: ensure the thread belongs to this guild
      if (target.guild?.id !== guildId) {
        await interaction.reply({
          content: '⚠️ That thread is not in this server.',
          ephemeral: true,
        });
        return;
      }

      if (sub === 'add') {
        const rawNote = interaction.options.getString('note');
        const note = (rawNote ?? '').trim() === '' ? null : rawNote;
        await service.register(target.id, guildId, interaction.user.id, note);
        await rescheduleThread(target.id);
        await interaction.reply({
          content: `✅ Registered <#${target.id}> for auto-bumps.${note ? `\n📝 Note: _${note}_` : ''}\n⏱️ Interval: **${10080}m** (default weekly)`,
          ephemeral: true,
        });
        return;
      }

      if (sub === 'remove') {
        const ok = await service.unregister(target.id);
        unscheduleThread(target.id);
        await interaction.reply({
          content: ok
            ? `🗑️ Unregistered <#${target.id}>.`
            : `ℹ️ <#${target.id}> was not registered.`,
          ephemeral: true,
        });
        return;
      }

      if (sub === 'set-note') {
        const rawNote = interaction.options.getString('note');
        const note = (rawNote ?? '').trim() === '' ? null : rawNote;
        const ok = await service.setNote(target.id, note);
        if (ok) await rescheduleThread(target.id); // reschedule is harmless here
        await interaction.reply({
          content: ok
            ? note
              ? `📝 Updated note for <#${target.id}>: _${note}_`
              : `🧹 Cleared note for <#${target.id}>.`
            : `⚠️ <#${target.id}> is not registered.`,
          ephemeral: true,
        });
        return;
      }

      if (sub === 'set-interval') {
        const minutes = interaction.options.getInteger('minutes', true);
        const ok = await service.setInterval(target.id, minutes);
        if (ok) await rescheduleThread(target.id); // re-arm timer with new window
        await interaction.reply({
          content: ok
            ? `⏱️ Interval for <#${target.id}> set to **${minutes} min**.`
            : `⚠️ <#${target.id}> is not registered.`,
          ephemeral: true,
        });
        return;
      }

      if (sub === 'bump-now') {
        await service.bumpNow(interaction.client, target.id);
        await interaction.reply({ content: `🔔 Bumped <#${target.id}>.`, ephemeral: true });
        return;
      }
    } catch (err) {
      console.error('bump-thread command error:', err);
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: '❌ Something went wrong.', ephemeral: true });
      } else {
        await interaction.reply({ content: '❌ Something went wrong.', ephemeral: true });
      }
    }
  },
};
