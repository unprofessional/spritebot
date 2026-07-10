import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import {
  getOrphanReport,
  getThreadBumpCheckCandidates,
  type HousekeepingCategory,
} from '../services/admin_housekeeping.service';

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

export async function handleAdminOrphans(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const categories = await getOrphanReport();
  categories.push(await buildDeadThreadBumpCategory(interaction));

  const hasFindings = categories.some((category) => category.count > 0);

  if (!hasFindings) {
    await interaction.editReply('✅ No orphans detected.');
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('SPRITEbot Orphan Report')
    .setDescription('Read-only audit. Manual-review categories are not safe to purge blindly.')
    .setColor(0xffbb33)
    .setTimestamp(new Date());

  for (const category of categories) {
    embed.addFields({
      name: category.label,
      value: formatCategory(category).slice(0, 1024),
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
