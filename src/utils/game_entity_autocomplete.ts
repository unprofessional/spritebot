import type { ApplicationCommandOptionChoiceData } from 'discord.js';
import type { GameEntity } from '../types/game_entity';

const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_CHOICE_NAME_LENGTH = 100;

interface RankedEntity {
  entity: GameEntity;
  rank: number;
  position: number;
}

export function buildGameEntityAutocompleteChoices(
  entities: GameEntity[],
  searchText: string,
): ApplicationCommandOptionChoiceData<string>[] {
  const query = normalizeSearchText(searchText);
  const ranked = entities
    .map((entity) => rankEntity(entity, query))
    .filter((entry): entry is RankedEntity => entry !== null)
    .sort(compareRankedEntities)
    .slice(0, MAX_AUTOCOMPLETE_CHOICES);

  const baseNames = ranked.map(({ entity }) => formatEntityChoiceName(entity));
  const totals = new Map<string, number>();
  for (const name of baseNames) totals.set(name, (totals.get(name) ?? 0) + 1);
  const seen = new Map<string, number>();

  return ranked.map(({ entity }, index) => {
    const baseName = baseNames[index] ?? formatEntityChoiceName(entity);
    const occurrence = (seen.get(baseName) ?? 0) + 1;
    seen.set(baseName, occurrence);
    return {
      name:
        (totals.get(baseName) ?? 0) > 1
          ? formatEntityChoiceName(entity, ` • ${occurrence}`)
          : baseName,
      value: entity.id,
    };
  });
}

export function formatEntityChoiceName(entity: GameEntity, qualifier = ''): string {
  const kind = entity.kind === 'npc' ? 'NPC' : 'Creature';
  const visibility = titleCase(entity.visibility);
  const context = ` — ${kind} • ${visibility}${qualifier}`;
  const availableNameLength = Math.max(1, MAX_CHOICE_NAME_LENGTH - context.length);
  const name =
    entity.name.length > availableNameLength
      ? `${entity.name.slice(0, Math.max(1, availableNameLength - 1))}…`
      : entity.name;
  return `${name}${context}`.slice(0, MAX_CHOICE_NAME_LENGTH);
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function rankEntity(entity: GameEntity, query: string): RankedEntity | null {
  const name = normalizeSearchText(entity.name);
  if (!query || name === query) return { entity, rank: 0, position: 0 };
  if (name.startsWith(query)) return { entity, rank: 1, position: 0 };

  const nameTokens = name.split(' ');
  const queryTokens = query.split(' ');
  if (queryTokens.every((part) => nameTokens.some((token) => token.startsWith(part)))) {
    return { entity, rank: 2, position: tokenPosition(nameTokens, queryTokens[0] ?? '', false) };
  }

  const substringPosition = name.indexOf(query);
  if (substringPosition >= 0) return { entity, rank: 3, position: substringPosition };
  if (queryTokens.every((part) => nameTokens.some((token) => token.includes(part)))) {
    return { entity, rank: 3, position: tokenPosition(nameTokens, queryTokens[0] ?? '', true) };
  }

  const subsequencePosition = subsequenceStart(name.replaceAll(' ', ''), query.replaceAll(' ', ''));
  return subsequencePosition === null ? null : { entity, rank: 4, position: subsequencePosition };
}

function compareRankedEntities(left: RankedEntity, right: RankedEntity): number {
  return (
    left.rank - right.rank ||
    left.position - right.position ||
    normalizeSearchText(left.entity.name).localeCompare(normalizeSearchText(right.entity.name)) ||
    left.entity.kind.localeCompare(right.entity.kind) ||
    left.entity.visibility.localeCompare(right.entity.visibility) ||
    left.entity.id.localeCompare(right.entity.id)
  );
}

function tokenPosition(nameTokens: string[], queryToken: string, substring: boolean): number {
  const index = nameTokens.findIndex((token) =>
    substring ? token.includes(queryToken) : token.startsWith(queryToken),
  );
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function subsequenceStart(value: string, query: string): number | null {
  let queryIndex = 0;
  let start = -1;
  for (let index = 0; index < value.length && queryIndex < query.length; index += 1) {
    if (value[index] !== query[queryIndex]) continue;
    if (start < 0) start = index;
    queryIndex += 1;
  }
  return queryIndex === query.length ? start : null;
}

function titleCase(value: string): string {
  return value
    .split('-')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
