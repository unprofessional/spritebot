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
import { canManageGameEntity, getGameEntity } from '../services/game_entity.service';
import type { HydratedGameEntity } from '../types/game_entity';
import { formatCharacterStatValue } from '../utils/character_stat_display';

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
    {
      label: 'Add Custom Field',
      value: 'custom-new|new|paragraph',
      description: 'Add a named custom field',
    },
    ...entity.stats.map((stat) => ({
      label: stat.label,
      value: `stat|${stat.template_id}|${stat.field_type}`,
      description: formatCharacterStatValue(stat) || 'Not set',
    })),
    ...entity.customFields.map((customField) => ({
      label: `[CUSTOM] ${customField.name}`,
      value: `custom|${customField.id}|paragraph`,
      description: customField.value || 'Not set',
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
  if (scope === 'custom-new') {
    const modal = new ModalBuilder()
      .setCustomId(`editGameEntityCustomModal:${entityId}`)
      .setTitle('Add Custom Entity Field')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Field Name')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('value')
            .setLabel('Field Value')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true),
        ),
      );
    await responder.showModal(modal);
    return;
  }

  const entity = await getManagedEntity(entityId, interaction.user.id);
  if (!entity) {
    await responder.respond({
      content: '❌ You cannot manage that NPC or creature.',
      ephemeral: true,
    });
    return;
  }

  const stat = scope === 'stat' ? entity.stats.find((entry) => entry.template_id === field) : null;
  const customField =
    scope === 'custom' ? entity.customFields.find((entry) => entry.id === field) : null;
  const label =
    stat?.label ??
    customField?.name ??
    {
      name: 'Name',
      bio: 'Biography',
      avatar_url: 'Avatar URL',
      rp_display_name: 'RP Display Name',
      rp_display_avatar_url: 'RP Display Avatar URL',
    }[field] ??
    field;

  const modal = new ModalBuilder()
    .setCustomId(`editGameEntityModal:${entityId}:${scope}:${field}`)
    .setTitle(truncate(scope === 'stat' ? `Edit Stat: ${label}` : `Edit ${label}`, 45));

  if (scope === 'stat' && (fieldType === 'count' || stat?.meta.max !== undefined)) {
    const max = stat?.meta.max ?? '';
    const current = stat?.meta.current ?? max;
    modal.addComponents(
      inputRow(`${field}:max`, `Max value for ${label}`, true, String(max)),
      inputRow(`${field}:current`, `Current value for ${label}`, false, String(current)),
    );
    await responder.showModal(modal);
    return;
  }

  const input = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(truncate(`New value for ${label}`, 45))
    .setStyle(fieldType === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(scope === 'core' && field === 'name');
  const existingValue =
    scope === 'stat'
      ? stat?.value
      : scope === 'custom'
        ? customField?.value
        : entity[field as keyof HydratedGameEntity];
  if (typeof existingValue === 'string' && existingValue) input.setValue(existingValue);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  await responder.showModal(modal);
}

async function getManagedEntity(entityId: string, requesterId: string) {
  if (!(await canManageGameEntity(entityId, requesterId))) return null;
  return getGameEntity(entityId);
}

function inputRow(id: string, label: string, required: boolean, value: string) {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(truncate(label, 45))
    .setStyle(TextInputStyle.Short)
    .setRequired(required);
  if (value) input.setValue(value);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
