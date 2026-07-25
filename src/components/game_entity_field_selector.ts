import {
  ActionRowBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { gatedImmediateModalInteractionPolicy } from '../discord/interaction_dispatch';
import type { DiscordInteractionResponder } from '../discord/interaction_responder';
import type { HydratedGameEntity } from '../types/game_entity';

export const id = 'editGameEntityField';
export const interactionPolicy = gatedImmediateModalInteractionPolicy;

export function build(entity: HydratedGameEntity) {
  const options = [
    { label: 'Name', value: 'core|name|short', description: entity.name },
    { label: 'Biography', value: 'core|bio|paragraph', description: entity.bio || 'Not set' },
    {
      label: 'Avatar URL',
      value: 'core|avatar_url|short',
      description: entity.avatar_url || 'Not set',
    },
    {
      label: 'RP Display Name',
      value: 'core|rp_display_name|short',
      description: entity.rp_display_name || 'Not set',
    },
    {
      label: 'RP Display Avatar URL',
      value: 'core|rp_display_avatar_url|short',
      description: entity.rp_display_avatar_url || 'Not set',
    },
    ...entity.stats.map((stat) => ({
      label: stat.label,
      value: `stat|${stat.template_id}|${stat.field_type}`,
      description: stat.value || 'Not set',
    })),
  ].slice(0, 25);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${id}:${entity.id}`)
      .setPlaceholder('Choose a field')
      .addOptions(
        options.map((option) => ({
          ...option,
          label: truncate(option.label, 100),
          description: truncate(option.description, 100),
        })),
      ),
  );
}

export async function handle(
  interaction: StringSelectMenuInteraction,
  responder: DiscordInteractionResponder,
): Promise<void> {
  const entityId = interaction.customId.split(':')[1];
  const [scope, field, fieldType] = (interaction.values[0] || '').split('|');
  if (!entityId || !scope || !field) {
    await responder.respond({ content: '⚠️ Invalid entity field.', ephemeral: true });
    return;
  }
  const input = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(truncate(`New value for ${field}`, 45))
    .setStyle(fieldType === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(scope === 'core' && field === 'name');
  const modal = new ModalBuilder()
    .setCustomId(`editGameEntityModal:${entityId}:${scope}:${field}`)
    .setTitle('Edit NPC / Creature')
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  await responder.showModal(modal);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
