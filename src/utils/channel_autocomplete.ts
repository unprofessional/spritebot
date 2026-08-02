import type { ApplicationCommandOptionChoiceData } from 'discord.js';
import { normalizeSearchText } from './game_entity_autocomplete';

const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;

export type ChannelAutocompleteCandidate = {
  id: string;
  name: string;
  kind: 'Voice' | 'Text';
  parentName?: string | null;
};

export function buildChannelAutocompleteChoices(
  channels: ChannelAutocompleteCandidate[],
  searchText: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const query = normalizeSearchText(searchText);
  const ranked = channels
    .map((channel) => ({ channel, rank: rankChannel(channel.name, query) }))
    .filter(
      (entry): entry is { channel: ChannelAutocompleteCandidate; rank: [number, number] } =>
        entry.rank !== null,
    )
    .sort(
      (left, right) =>
        left.rank[0] - right.rank[0] ||
        left.rank[1] - right.rank[1] ||
        normalizeSearchText(left.channel.name).localeCompare(
          normalizeSearchText(right.channel.name),
        ) ||
        normalizeSearchText(left.channel.parentName ?? '').localeCompare(
          normalizeSearchText(right.channel.parentName ?? ''),
        ) ||
        left.channel.id.localeCompare(right.channel.id),
    )
    .slice(0, MAX_AUTOCOMPLETE_CHOICES);
  const baseNames = ranked.map(({ channel }) => formatChannelChoiceName(channel));
  const totals = new Map<string, number>();
  for (const name of baseNames) totals.set(name, (totals.get(name) ?? 0) + 1);
  const seen = new Map<string, number>();

  return ranked.map(({ channel }, index) => {
    const baseName = baseNames[index] ?? formatChannelChoiceName(channel);
    const occurrence = (seen.get(baseName) ?? 0) + 1;
    seen.set(baseName, occurrence);
    return {
      name:
        (totals.get(baseName) ?? 0) > 1
          ? formatChannelChoiceName(channel, ` • ${occurrence}`)
          : baseName,
      value: channel.id,
    };
  });
}

function rankChannel(name: string, query: string): [number, number] | null {
  const normalized = normalizeSearchText(name);
  if (!query || normalized === query) return [0, 0];
  if (normalized.startsWith(query)) return [1, 0];
  const position = normalized.indexOf(query);
  return position >= 0 ? [2, position] : null;
}

function formatChannelChoiceName(channel: ChannelAutocompleteCandidate, qualifier = ''): string {
  const fixedContext = ` — ${channel.kind}${qualifier}`;
  const parentPrefix = ' • ';
  const maxParentLength = Math.max(
    0,
    MAX_CHOICE_NAME_LENGTH - 1 - fixedContext.length - parentPrefix.length,
  );
  const parentName = channel.parentName ? truncate(channel.parentName, maxParentLength) : '';
  const context = ` — ${channel.kind}${parentName ? `${parentPrefix}${parentName}` : ''}${qualifier}`;
  const availableNameLength = Math.max(1, MAX_CHOICE_NAME_LENGTH - context.length);
  const name = truncate(channel.name, availableNameLength);
  return `${name}${context}`.slice(0, MAX_CHOICE_NAME_LENGTH);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 1)}…`;
}
