// src/services/inventory.service.ts

import { CharacterWithInventory, InventoryItem } from 'types/character';
import { CharacterDAO } from '../dao/character.dao';
import { CharacterInventoryDAO } from '../dao/character_inventory.dao';
import { CharacterInventoryFieldDAO } from '../dao/character_inventory_field.dao';
import type { FieldInput } from '../types/field_input';

const characterDAO = new CharacterDAO();
const inventoryDAO = new CharacterInventoryDAO();
const fieldDAO = new CharacterInventoryFieldDAO();

export async function createItem(
  characterId: string,
  {
    name,
    type = null,
    description = null,
    quantity = 1,
    equipped = false,
    fields = {},
  }: {
    name: string;
    type?: string | null;
    description?: string | null;
    quantity?: number;
    equipped?: boolean;
    fields?: Record<string, FieldInput>;
  },
) {
  const item = await inventoryDAO.create({
    characterId,
    name,
    type,
    description,
    quantity: normalizeQuantity(quantity),
    equipped,
  });

  if (fields && typeof fields === 'object') {
    await fieldDAO.bulkUpsert(item.id, fields);
  }

  return item;
}

export async function getInventory(characterId: string): Promise<InventoryItem[]> {
  const items = await inventoryDAO.findByCharacter(characterId);

  const enriched: InventoryItem[] = await Promise.all(
    items.map(async (item) => {
      const rawFields = await fieldDAO.findByInventory(item.id);
      const fields: Record<string, unknown> = {};
      for (const field of rawFields) {
        fields[field.name] = field.value;
      }

      return {
        id: item.id,
        name: item.name,
        type: item.type,
        description: item.description,
        quantity: item.quantity,
        equipped: item.equipped,
        fields,
      };
    }),
  );

  return enriched;
}

export async function getItem(itemId: string): Promise<InventoryItem | null> {
  const item = await inventoryDAO.findById(itemId);
  if (!item) return null;

  return hydrateItem(item);
}

export async function getItemForCharacter(
  characterId: string,
  itemId: string,
): Promise<InventoryItem | null> {
  const item = await inventoryDAO.findById(itemId);
  if (!item || item.character_id !== characterId) return null;

  return hydrateItem(item);
}

async function hydrateItem(item: Awaited<ReturnType<CharacterInventoryDAO['findById']>>) {
  if (!item) return null;

  const rawFields = await fieldDAO.findByInventory(item.id);
  const fields: Record<string, unknown> = {};
  for (const field of rawFields) {
    fields[field.name] = field.value;
  }

  return {
    id: item.id,
    name: item.name,
    type: item.type,
    description: item.description,
    quantity: item.quantity,
    equipped: item.equipped,
    fields,
  };
}

export async function updateItem(
  characterId: string,
  itemId: string,
  {
    name,
    type = null,
    description = null,
    quantity = 1,
  }: {
    name: string;
    type?: string | null;
    description?: string | null;
    quantity?: number;
  },
): Promise<InventoryItem | null> {
  const existing = await inventoryDAO.findById(itemId);
  if (!existing || existing.character_id !== characterId) return null;

  await inventoryDAO.updateById(itemId, {
    name,
    type,
    description,
    quantity: normalizeQuantity(quantity),
  });

  return getItem(itemId);
}

export async function getCharacterWithInventory(
  characterId: string,
): Promise<CharacterWithInventory | null> {
  const character = await characterDAO.findById(characterId);
  if (!character) return null;

  const inventory = await getInventory(characterId);

  return {
    id: character.id,
    game_id: character.game_id,
    name: character.name,
    inventory,
  };
}

export async function updateField(
  inventoryId: string,
  name: string,
  value: string,
  meta: Record<string, unknown> = {},
) {
  return fieldDAO.create(inventoryId, name, value, meta);
}

export async function updateFields(inventoryId: string, fieldMap: Record<string, FieldInput>) {
  return fieldDAO.bulkUpsert(inventoryId, fieldMap);
}

export async function deleteItem(inventoryId: string) {
  await fieldDAO.deleteByInventory(inventoryId);
  await inventoryDAO.deleteById(inventoryId);
}

export async function deleteItemForCharacter(
  characterId: string,
  itemId: string,
): Promise<boolean> {
  const existing = await inventoryDAO.findById(itemId);
  if (!existing || existing.character_id !== characterId) return false;

  await deleteItem(itemId);
  return true;
}

export async function setEquipped(inventoryId: string, equipped: boolean) {
  return inventoryDAO.toggleEquipped(inventoryId, equipped);
}

export async function setQuantity(inventoryId: string, quantity: number) {
  return inventoryDAO.updateQuantity(inventoryId, normalizeQuantity(quantity));
}

export async function deleteInventoryByCharacter(characterId: string) {
  const items = await inventoryDAO.findByCharacter(characterId);
  for (const item of items) {
    await fieldDAO.deleteByInventory(item.id);
    await inventoryDAO.deleteById(item.id);
  }
}

function normalizeQuantity(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error('Inventory item quantity must be a positive integer.');
  }

  return quantity;
}
