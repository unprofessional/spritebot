import {
  ActionRowBuilder,
  ButtonBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { build as buildConfirmPurgeButton } from '../components/confirm_purge_button';
import {
  getOrphanReport,
  getThreadBumpCheckCandidates,
  type HousekeepingCategory,
} from '../services/admin_housekeeping.service';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';

const THREAD_BUMP_CHECK_LIMIT = 25;

function formatExamples(category: HousekeepingCategory): string {
  if (!category.examples.length) return 'No examples.';

  return category.examples
    .slice(0, 3)
    .map((example) => `• **${example.name}** \`${example.id}\` — ${example.detail}`)
    .join('\n');
}

function formatCategory(category: HousekeepingCategory): string {
  const reviewMode = category.safeToPurge ? 'safe purge candidate' : 'manual review';
  return [`**${category.count}** found · ${reviewMode}`, formatExamples(category)].join('\n');
}

function buildOrphanReportEmbed(
  categories: HousekeepingCategory[],
  description: string,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('SPRITEbot Orphan Report')
    .setDescription(description)
    .setColor(0xffbb33)
    .setTimestamp(new Date());

  for (const category of categories) {
    embed.addFields({
      name: category.label,
      value: formatCategory(category).slice(0, 1024),
      inline: false,
    });
  }

  return embed;
}

async function buildDeadThreadBumpCategory(
  interaction: ChatInputCommandInteraction,
): Promise<HousekeepingCategory> {
  const candidates = await getThreadBumpCheckCandidates(THREAD_BUMP_CHECK_LIMIT);
  const deadExamples: HousekeepingCategory['examples'] = [];

  for (const candidate of candidates) {
    const channel = await interaction.client.channels.fetch(candidate.threadId).catch(() => null);
    if (!channel) {
      deadExamples.push({
        id: candidate.threadId,
        name: candidate.threadId,
        detail: candidate.detail,
      });
    }
  }

  return {
    category: 'dead-thread-bumps',
    label: `📌 Dead thread bumps (checked ${candidates.length}/${THREAD_BUMP_CHECK_LIMIT})`,
    count: deadExamples.length,
    examples: deadExamples.slice(0, 3),
    safeToPurge: false,
  };
}

export async function handleAdminOrphans(
  interaction: ChatInputCommandInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const categories = await getOrphanReport();
  categories.push(await buildDeadThreadBumpCategory(interaction));

  const hasFindings = categories.some((category) => category.count > 0);

  if (!hasFindings) {
    await responder.respond({ content: '✅ No orphans detected.', ephemeral: true });
    return;
  }

  const embed = buildOrphanReportEmbed(
    categories,
    'Read-only audit. Manual-review categories are not safe to purge blindly.',
  );

  await responder.respond({ embeds: [embed], ephemeral: true });
}

export async function handleAdminOrphansPurge(
  interaction: ChatInputCommandInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const categories = await getOrphanReport();
  const safeCategories = categories.filter((category) => category.safeToPurge);
  const purgeCount = safeCategories.reduce((sum, category) => sum + category.count, 0);

  const embed = buildOrphanReportEmbed(
    safeCategories,
    [
      'Purge preview. This permanently deletes only categories marked safe for cleanup.',
      'This action is irreversible. Abandoned games, empty games, player links, and dead thread bumps are not purged.',
    ].join('\n'),
  );

  if (purgeCount === 0) {
    await responder.respond({
      content: '✅ No safe orphan rows are currently eligible for purge.',
      embeds: [embed],
      ephemeral: true,
    });
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    buildConfirmPurgeButton(interaction.user.id),
  );

  await responder.respond({
    content: `⚠️ Confirm purge will permanently delete **${purgeCount}** row(s).`,
    embeds: [embed],
    components: [row],
    ephemeral: true,
  });
}
