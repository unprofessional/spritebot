import {
  LabelBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APISelectMenuOption,
  type ModalSubmitFields,
} from 'discord.js';
import { discordCustomId } from './discord_custom_id';

interface ModalTextInputOptions {
  customId: string;
  label: string;
  description?: string;
  style?: TextInputStyle;
  required?: boolean;
  value?: string;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
}

interface ModalStringSelectOption {
  label: string;
  value: string;
  description?: string;
  default?: boolean;
}

interface ModalStringSelectOptions {
  customId: string;
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  options: readonly ModalStringSelectOption[];
}

export function modalTextInput(options: ModalTextInputOptions): LabelBuilder {
  const input = new TextInputBuilder()
    .setCustomId(discordCustomId(options.customId))
    .setStyle(options.style ?? TextInputStyle.Short)
    .setRequired(options.required ?? true);

  if (options.value !== undefined) input.setValue(options.value);
  if (options.placeholder !== undefined) input.setPlaceholder(options.placeholder);
  if (options.minLength !== undefined) input.setMinLength(options.minLength);
  if (options.maxLength !== undefined) input.setMaxLength(options.maxLength);

  return label(options.label, options.description).setTextInputComponent(input);
}

/** Migrates an existing text-input builder into Discord's current Label wrapper. */
export function modalTextInputBuilder(input: TextInputBuilder, description?: string): LabelBuilder {
  const { label: inputLabel, ...inputData } = input.toJSON();
  if (!inputLabel) throw new Error('Modal text inputs require a label.');
  return label(inputLabel, description).setTextInputComponent(new TextInputBuilder(inputData));
}

export function modalStringSelect(options: ModalStringSelectOptions): LabelBuilder {
  if (options.options.length === 0 || options.options.length > 25) {
    throw new RangeError('Modal string selects require between 1 and 25 options.');
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(discordCustomId(options.customId))
    .setRequired(options.required ?? true)
    .addOptions(
      options.options.map(({ label: optionLabel, value, description, default: isDefault }) => {
        const option: APISelectMenuOption = {
          label: optionLabel,
          value,
          default: isDefault,
        };
        if (description !== undefined) option.description = description;
        return option;
      }),
    );

  if (options.placeholder !== undefined) select.setPlaceholder(options.placeholder);
  return label(options.label, options.description).setStringSelectMenuComponent(select);
}

/** Reads a current modal select while accepting an already-open legacy text modal during rollout. */
export function getModalStringSelectValue(
  fields: Pick<ModalSubmitFields, 'getStringSelectValues' | 'getTextInputValue'>,
  customId: string,
): string | undefined {
  try {
    return fields.getStringSelectValues(customId)[0];
  } catch {
    return fields.getTextInputValue(customId);
  }
}

function label(text: string, description?: string): LabelBuilder {
  const component = new LabelBuilder().setLabel(text);
  if (description !== undefined) component.setDescription(description);
  return component;
}
