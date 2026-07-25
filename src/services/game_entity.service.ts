import { GameDAO } from '../dao/game.dao';
import { GameEntityDAO } from '../dao/game_entity.dao';
import { GameEntityCustomFieldDAO } from '../dao/game_entity_custom_field.dao';
import { GameEntityInventoryDAO } from '../dao/game_entity_inventory.dao';
import { GameEntityInventoryFieldDAO } from '../dao/game_entity_inventory_field.dao';
import { GameEntityStatFieldDAO } from '../dao/game_entity_stat_field.dao';
import { StatTemplateDAO } from '../dao/stat_template.dao';
import type { FieldInput } from '../types/field_input';
import type {
  GameEntity,
  GameEntityKind,
  GameEntityVisibility,
  HydratedGameEntity,
  HydratedGameEntityInventoryItem,
  HydratedGameEntityStatField,
  JsonObject,
} from '../types/game_entity';
import { getCountStatDefaults } from '../utils/count_stat_defaults';

const gameDAO = new GameDAO();
const entityDAO = new GameEntityDAO();
const statDAO = new GameEntityStatFieldDAO();
const customDAO = new GameEntityCustomFieldDAO();
const inventoryDAO = new GameEntityInventoryDAO();
const inventoryFieldDAO = new GameEntityInventoryFieldDAO();
const templateDAO = new StatTemplateDAO();
const RESTORE_WINDOW_DAYS = 30;

type StatFieldInput = string | { value?: string; meta?: JsonObject };

interface EntityMetaInput {
  name: string;
  avatar_url?: string | null;
  rp_display_name?: string | null;
  rp_display_avatar_url?: string | null;
  bio?: string | null;
  visibility?: GameEntityVisibility;
}

interface InventoryInput {
  name: string;
  type?: string | null;
  description?: string | null;
  quantity?: number;
  equipped?: boolean;
  fields?: Record<string, FieldInput>;
}

export type RestoreGameEntityResult =
  | { ok: true; entity: HydratedGameEntity }
  | {
      ok: false;
      reason: 'not_found' | 'not_owner' | 'not_deleted' | 'expired' | 'game_inactive';
    };

export async function createGameEntity({
  requesterId,
  gameId,
  kind,
  stats = {},
  customFields = {},
  ...meta
}: {
  requesterId: string;
  gameId: string;
  kind: GameEntityKind;
  stats?: Record<string, StatFieldInput>;
  customFields?: Record<string, FieldInput>;
} & EntityMetaInput): Promise<HydratedGameEntity> {
  await requireManagedGame(gameId, requesterId);
  const templates = await templateDAO.findByGame(gameId);
  validateTemplateIds(gameId, templates, Object.keys(stats));

  const entity = await entityDAO.create({
    game_id: gameId,
    created_by: requesterId,
    kind,
    ...meta,
  });

  await statDAO.bulkUpsert(entity.id, stats);
  await customDAO.bulkUpsert(entity.id, customFields);

  const hydrated = await getGameEntity(entity.id);
  if (!hydrated) throw new Error('Created game entity could not be hydrated.');
  return hydrated;
}

export async function getGameEntity(gameEntityId: string): Promise<HydratedGameEntity | null> {
  const entity = await entityDAO.findActiveById(gameEntityId);
  if (!entity) return null;

  const [stats, customFields, templates, inventory] = await Promise.all([
    statDAO.findByGameEntity(gameEntityId),
    customDAO.findByGameEntity(gameEntityId),
    templateDAO.findByGame(entity.game_id),
    getGameEntityInventory(gameEntityId),
  ]);
  const statMap = new Map(stats.map((stat) => [stat.template_id, stat]));
  const templateIds = new Set(templates.map((template) => template.id));

  const hydratedStats: HydratedGameEntityStatField[] = templates.map((template) => {
    const stat = statMap.get(template.id);
    const countDefaults = template.field_type === 'count' ? getCountStatDefaults(template) : null;
    return {
      ...(stat?.id ? { id: stat.id } : {}),
      game_entity_id: gameEntityId,
      template_id: template.id,
      value: stat?.value ?? template.default_value ?? '',
      meta:
        stat?.meta ??
        (countDefaults && countDefaults.max !== null
          ? { max: countDefaults.max, current: countDefaults.current }
          : {}),
      label: template.label || template.id,
      field_type: template.field_type,
      sort_order: template.sort_order ?? 999,
    };
  });

  for (const stat of stats) {
    if (templateIds.has(stat.template_id)) continue;
    hydratedStats.push({
      ...stat,
      label: stat.template_id,
      field_type: 'short',
      sort_order: 999,
    });
  }

  return {
    ...entity,
    stats: hydratedStats,
    customFields,
    inventory,
  };
}

export async function getGameEntities(
  gameId: string,
  kind?: GameEntityKind,
): Promise<GameEntity[]> {
  const game = await gameDAO.findById(gameId);
  if (!game) return [];
  return entityDAO.findByGame(gameId, kind);
}

export async function canManageGameEntity(
  gameEntityId: string,
  requesterId: string,
): Promise<boolean> {
  const entity = await entityDAO.findActiveById(gameEntityId);
  if (!entity) return false;
  const game = await gameDAO.findById(entity.game_id);
  return game?.created_by === requesterId;
}

export async function updateGameEntityMeta(
  gameEntityId: string,
  requesterId: string,
  fields: Partial<EntityMetaInput>,
): Promise<HydratedGameEntity | null> {
  const entity = await requireManagedEntity(gameEntityId, requesterId);
  const updated = await entityDAO.updateMeta(gameEntityId, {
    name: entity.name,
    avatar_url: entity.avatar_url,
    rp_display_name: entity.rp_display_name,
    rp_display_avatar_url: entity.rp_display_avatar_url,
    bio: entity.bio,
    visibility: entity.visibility,
    ...fields,
  });
  if (!updated) return null;
  return getGameEntity(gameEntityId);
}

export async function deleteGameEntity(
  gameEntityId: string,
  requesterId: string,
): Promise<boolean> {
  await requireManagedEntity(gameEntityId, requesterId);
  return Boolean(await entityDAO.softDelete(gameEntityId));
}

export async function getRestorableGameEntities(
  gameId: string,
  requesterId: string,
): Promise<GameEntity[]> {
  await requireManagedGame(gameId, requesterId);
  return entityDAO.findRestorableByGame(gameId);
}

export async function restoreGameEntity(
  gameEntityId: string,
  requesterId: string,
): Promise<RestoreGameEntityResult> {
  const entity = await entityDAO.findById(gameEntityId);
  if (!entity) return { ok: false, reason: 'not_found' };

  const game = await gameDAO.findById(entity.game_id);
  if (!game) return { ok: false, reason: 'game_inactive' };
  if (game.created_by !== requesterId) return { ok: false, reason: 'not_owner' };
  if (!entity.deleted_at) return { ok: false, reason: 'not_deleted' };
  if (restoreWindowExpired(entity.deleted_at)) return { ok: false, reason: 'expired' };

  const restored = await entityDAO.restore(gameEntityId);
  if (!restored) return { ok: false, reason: 'not_found' };
  const hydrated = await getGameEntity(gameEntityId);
  if (!hydrated) return { ok: false, reason: 'not_found' };
  return { ok: true, entity: hydrated };
}

export async function updateGameEntityStat(
  gameEntityId: string,
  requesterId: string,
  templateId: string,
  value: string,
  meta: JsonObject = {},
) {
  const entity = await requireManagedEntity(gameEntityId, requesterId);
  const template = await templateDAO.findById(templateId);
  if (!template || template.game_id !== entity.game_id) {
    throw new Error('Stat template does not belong to the game entity game.');
  }
  return statDAO.create(gameEntityId, templateId, value, meta);
}

export async function updateGameEntityStats(
  gameEntityId: string,
  requesterId: string,
  fields: Record<string, StatFieldInput>,
) {
  const entity = await requireManagedEntity(gameEntityId, requesterId);
  const templates = await templateDAO.findByGame(entity.game_id);
  validateTemplateIds(entity.game_id, templates, Object.keys(fields));
  return statDAO.bulkUpsert(gameEntityId, fields);
}

export async function updateGameEntityCustomField(
  gameEntityId: string,
  requesterId: string,
  name: string,
  value: string,
  meta: JsonObject = {},
) {
  await requireManagedEntity(gameEntityId, requesterId);
  return customDAO.create(gameEntityId, name, value, meta);
}

export async function updateGameEntityCustomFields(
  gameEntityId: string,
  requesterId: string,
  fields: Record<string, FieldInput>,
) {
  await requireManagedEntity(gameEntityId, requesterId);
  return customDAO.bulkUpsert(gameEntityId, fields);
}

export async function createGameEntityInventoryItem(
  gameEntityId: string,
  requesterId: string,
  {
    name,
    type = null,
    description = null,
    quantity = 1,
    equipped = false,
    fields = {},
  }: InventoryInput,
): Promise<HydratedGameEntityInventoryItem> {
  await requireManagedEntity(gameEntityId, requesterId);
  const item = await inventoryDAO.create({
    gameEntityId,
    name,
    type,
    description,
    quantity: normalizeQuantity(quantity),
    equipped,
  });
  await inventoryFieldDAO.bulkUpsert(item.id, fields);
  return { ...item, fields: await inventoryFieldDAO.findByInventory(item.id) };
}

export async function getGameEntityInventory(
  gameEntityId: string,
): Promise<HydratedGameEntityInventoryItem[]> {
  const items = await inventoryDAO.findByGameEntity(gameEntityId);
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      fields: await inventoryFieldDAO.findByInventory(item.id),
    })),
  );
}

export async function updateGameEntityInventoryItem(
  gameEntityId: string,
  requesterId: string,
  itemId: string,
  {
    name,
    type = null,
    description = null,
    quantity = 1,
  }: Omit<InventoryInput, 'equipped' | 'fields'>,
): Promise<HydratedGameEntityInventoryItem | null> {
  await requireManagedInventoryItem(gameEntityId, itemId, requesterId);
  const updated = await inventoryDAO.updateById(itemId, {
    name,
    type,
    description,
    quantity: normalizeQuantity(quantity),
  });
  if (!updated) return null;
  return { ...updated, fields: await inventoryFieldDAO.findByInventory(itemId) };
}

export async function updateGameEntityInventoryField(
  gameEntityId: string,
  requesterId: string,
  itemId: string,
  name: string,
  value: string,
  meta: JsonObject = {},
) {
  await requireManagedInventoryItem(gameEntityId, itemId, requesterId);
  return inventoryFieldDAO.create(itemId, name, value, meta);
}

export async function setGameEntityInventoryEquipped(
  gameEntityId: string,
  requesterId: string,
  itemId: string,
  equipped: boolean,
): Promise<HydratedGameEntityInventoryItem | null> {
  await requireManagedInventoryItem(gameEntityId, itemId, requesterId);
  const updated = await inventoryDAO.toggleEquipped(itemId, equipped);
  if (!updated) return null;
  return { ...updated, fields: await inventoryFieldDAO.findByInventory(itemId) };
}

export async function setGameEntityInventoryQuantity(
  gameEntityId: string,
  requesterId: string,
  itemId: string,
  quantity: number,
): Promise<HydratedGameEntityInventoryItem | null> {
  await requireManagedInventoryItem(gameEntityId, itemId, requesterId);
  const updated = await inventoryDAO.updateQuantity(itemId, normalizeQuantity(quantity));
  if (!updated) return null;
  return { ...updated, fields: await inventoryFieldDAO.findByInventory(itemId) };
}

export async function deleteGameEntityInventoryItem(
  gameEntityId: string,
  requesterId: string,
  itemId: string,
): Promise<boolean> {
  await requireManagedInventoryItem(gameEntityId, itemId, requesterId);
  await inventoryDAO.deleteById(itemId);
  return true;
}

async function requireManagedGame(gameId: string, requesterId: string) {
  const game = await gameDAO.findById(gameId);
  if (!game) throw new Error('Game not found or inactive.');
  if (game.created_by !== requesterId)
    throw new Error('Only the game creator can manage entities.');
  return game;
}

async function requireManagedEntity(
  gameEntityId: string,
  requesterId: string,
): Promise<GameEntity> {
  const entity = await entityDAO.findActiveById(gameEntityId);
  if (!entity) throw new Error('Game entity not found or inactive.');
  await requireManagedGame(entity.game_id, requesterId);
  return entity;
}

async function requireManagedInventoryItem(
  gameEntityId: string,
  itemId: string,
  requesterId: string,
) {
  await requireManagedEntity(gameEntityId, requesterId);
  const item = await inventoryDAO.findById(itemId);
  if (!item || item.game_entity_id !== gameEntityId) {
    throw new Error('Inventory item does not belong to the game entity.');
  }
  return item;
}

function validateTemplateIds(
  gameId: string,
  templates: Awaited<ReturnType<StatTemplateDAO['findByGame']>>,
  templateIds: string[],
): void {
  const validIds = new Set(templates.map((template) => template.id));
  if (templateIds.some((templateId) => !validIds.has(templateId))) {
    throw new Error(`Stat template does not belong to active game ${gameId}.`);
  }
}

function restoreWindowExpired(deletedAt: string): boolean {
  const deletedTime = new Date(deletedAt).getTime();
  const cutoff = Date.now() - RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return deletedTime < cutoff;
}

function normalizeQuantity(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error('Inventory item quantity must be a positive integer.');
  }
  return quantity;
}
