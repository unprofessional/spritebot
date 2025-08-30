// src/commands/bump-thread.ts

import {
  CacheType,
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ThreadChannel,
} from 'discord.js';
import { rescheduleThread, unscheduleThread } from '../schedulers/bump_scheduler';
import { ThreadBumpService } from '../services/thread_bump.service';
import { computeDefaultIntervalMinutes } from '../config/bump_config';

const service = new ThreadBumpService();

// --- tiny helpers for readable debug logs ---

const TYPE_LABEL: Record<number, string> = {
  [ChannelType.GuildText]: 'GuildText',
  [ChannelType.DM]: 'DM',
  [ChannelType.GuildVoice]: 'GuildVoice',
  [ChannelType.GroupDM]: 'GroupDM',
  [ChannelType.GuildCategory]: 'GuildCategory',
  [ChannelType.GuildAnnouncement]: 'GuildAnnouncement',
  [ChannelType.AnnouncementThread]: 'AnnouncementThread',
  [ChannelType.PublicThread]: 'PublicThread',
  [ChannelType.PrivateThread]: 'PrivateThread',
  [ChannelType.GuildStageVoice]: 'GuildStageVoice',
  [ChannelType.GuildDirectory]: 'GuildDirectory',
  [ChannelType.GuildForum]: 'GuildForum',
  // (v14+) sometimes GuildMedia exists:
  [ChannelType.GuildMedia]: 'GuildMedia',
};

function typeLabel(t: number | undefined): string {
  if (t === undefined) return 'undefined';
  return `${TYPE_LABEL[t] ?? 'Unknown'}(${t})`;
}

function chInfo(ch: any): string {
  if (!ch) return 'null';
  const bits: string[] = [];
  bits.push(`id=${ch.id ?? 'n/a'}`);
  bits.push(`name=${ch.name ?? 'n/a'}`);
  bits.push(`type=${typeLabel(ch.type)}`);
  if ('isThread' in ch) bits.push(`hasIsThread=${typeof ch.isThread === 'function'}`);
  if ('parentId' in ch) bits.push(`parentId=${ch.parentId ?? 'n/a'}`);
  if ('archived' in ch) bits.push(`archived=${ch.archived}`);
  if ('locked' in ch) bits.push(`locked=${ch.locked}`);
  return bits.join(' ');
}

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

function isThreadType(t: number | undefined): boolean {
  return (
    t === ChannelType.PublicThread ||
    t === ChannelType.PrivateThread ||
    t === ChannelType.AnnouncementThread
  );
}

async function resolveTargetThread(
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<ThreadChannel | null> {
  // 1) If user supplied a channel option, require it to be a thread
  const opt = interaction.options.getChannel('thread', false);
  if (opt) {
    console.log(
      `[bump-thread] resolve: option provided -> ${chInfo(opt)} | current=${chInfo(
        interaction.channel,
      )}`,
    );
    return isThreadType(opt.type) ? (opt as ThreadChannel) : null;
  }

  // 2) Otherwise, use the current channel if it's a thread
  const ch = interaction.channel as any;
  console.log(`[bump-thread] resolve: using current channel -> ${chInfo(ch)}`);
  if (ch && isThreadType(ch.type)) return ch as ThreadChannel;

  // 3) Fallback: fetch authoritative channel by ID (handles partials/edge cases)
  const fetched = await interaction.client.channels.fetch(interaction.channelId).catch((e) => {
    console.warn(
      `[bump-thread] resolve: fetch by channelId failed id=${interaction.channelId} err=`,
      e,
    );
    return null;
  });
  console.log(`[bump-thread] resolve: fetched by id -> ${chInfo(fetched)}`);
  if (fetched && isThreadType((fetched as any).type)) return fetched as ThreadChannel;

  console.log('[bump-thread] resolve: no thread detected (returning null)');
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bump-thread')
    .setDescription('Manage auto-bumps for threads in this server.')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Register a thread for auto-bumps (defaults to archive-aware cadence).')
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
            .setDescription('Minutes between bumps (e.g., 1440 = daily, 10050 = weekly)')
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

      console.log(
        `[bump-thread] exec: sub=${sub} guild=${guildId} channelId=${interaction.channelId} current=${chInfo(
          interaction.channel,
        )}`,
      );

      if (!hasThreadPerms(interaction)) {
        console.log('[bump-thread] exec: missing ManageThreads/Admin on invoker');
        await interaction.reply({
          content: '❌ You need **Manage Threads** to do that.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'list') {
        const rows = await service.listGuild(guildId);
        console.log(`[bump-thread] list: rows=${rows.length}`);
        if (rows.length === 0) {
          await interaction.reply({
            content: 'ℹ️ No registered threads in this server.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        // Archive-aware next times (async)
        const lines = await Promise.all(
          rows.map(async (r) => {
            const due = await service.nextDueAt(interaction.client, r);
            const ts = `<t:${Math.floor(due.getTime() / 1000)}:R>`; // relative time
            return `• <#${r.thread_id}> — every **${r.interval_minutes}m** — next ${ts}${
              r.note ? ` — _${r.note}_` : ''
            }`;
          }),
        );

        await interaction.reply({
          content: `📋 **Registered bump threads:**\n${lines.join('\n')}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const target = await resolveTargetThread(interaction);
      console.log(
        `[bump-thread] exec: resolved target -> ${target ? chInfo(target) : 'null (no thread)'}`,
      );

      if (!target) {
        await interaction.reply({
          content:
            '⚠️ You must run this in a thread or specify a valid thread with `/bump-thread … thread:`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Safety: ensure the thread belongs to this guild
      if (target.guild?.id !== guildId) {
        console.log(
          `[bump-thread] exec: thread guild mismatch (thread.guild.id=${target.guild?.id} vs guildId=${guildId})`,
        );
        await interaction.reply({
          content: '⚠️ That thread is not in this server.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'add') {
        const rawNote = interaction.options.getString('note');
        const note = (rawNote ?? '').trim() === '' ? null : rawNote;

        const defaultMinutes = computeDefaultIntervalMinutes(target);
        console.log(
          `[bump-thread] add: thread=${target.id} type=${typeLabel(
            target.type,
          )} autoArchive=${target.autoArchiveDuration ?? 'n/a'} defaultMinutes=${defaultMinutes} note=${
            note ?? 'null'
          }`,
        );

        // Store explicitly so we aren’t relying on SQL’s 10080 fallback
        await service.register(target.id, guildId, interaction.user.id, note, defaultMinutes);

        await rescheduleThread(target.id);

        await interaction.reply({
          content:
            `✅ Registered <#${target.id}> for auto-bumps.` +
            (note ? `\n📝 Note: _${note}_` : '') +
            `\n⏱️ Interval: **${defaultMinutes}m**` +
            (target.autoArchiveDuration ? ` (auto-archive: ${target.autoArchiveDuration}m)` : ''),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'remove') {
        console.log(`[bump-thread] remove: thread=${target.id}`);
        unscheduleThread(target.id); // cancel any pending timer immediately
        const ok = await service.unregister(target.id);
        unscheduleThread(target.id); // cancel again in case of race
        await interaction.reply({
          content: ok
            ? `🗑️ Unregistered <#${target.id}>.`
            : `ℹ️ <#${target.id}> was not registered.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'set-note') {
        const rawNote = interaction.options.getString('note');
        const note = (rawNote ?? '').trim() === '' ? null : rawNote;
        console.log(`[bump-thread] set-note: thread=${target.id} note=${note ?? 'null'}`);
        const ok = await service.setNote(target.id, note);
        if (ok) await rescheduleThread(target.id); // reschedule is harmless here
        await interaction.reply({
          content: ok
            ? note
              ? `📝 Updated note for <#${target.id}>: _${note}_`
              : `🧹 Cleared note for <#${target.id}>.`
            : `⚠️ <#${target.id}> is not registered.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'set-interval') {
        const minutes = interaction.options.getInteger('minutes', true);
        const archive = target.autoArchiveDuration ?? 10080;
        const risky = minutes >= archive;
        console.log(
          `[bump-thread] set-interval: thread=${target.id} minutes=${minutes} archive=${archive} risky=${risky}`,
        );
        const ok = await service.setInterval(target.id, minutes);
        if (ok) await rescheduleThread(target.id);
        await interaction.reply({
          content: ok
            ? `⏱️ Interval for <#${target.id}> set to **${minutes} min**.` +
              (risky
                ? `\n⚠️ Heads up: this is ≥ the thread’s auto-archive window (${archive}m). The bot will need **Manage Threads** to unarchive before bumping.`
                : '')
            : `⚠️ <#${target.id}> is not registered.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (sub === 'bump-now') {
        console.log(`[bump-thread] bump-now: thread=${target.id}`);
        await service.bumpNow(interaction.client, target.id, { deleteAfter: false });
        await interaction.reply({
          content: `🔔 Bumped <#${target.id}>.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } catch (err) {
      console.error('bump-thread command error:', err);
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: '❌ Something went wrong.',
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: '❌ Something went wrong.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};
