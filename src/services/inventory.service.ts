// src/services/inventory.service.ts

import { CharacterWithInventory, InventoryItem } from 'types/character';
import { CharacterDAO } from '../dao/character.dao';
import { CharacterInventoryDAO } from '../dao/character_inventory.dao';
import { CharacterInventoryFieldDAO } from '../dao/character_inventory_field.dao';

const characterDAO = new CharacterDAO();
const inventoryDAO = new CharacterInventoryDAO();
const fieldDAO = new CharacterInventoryFieldDAO();

export async function createItem(
  characterId: string,
  {
    name,
    type = null,
    description = null,
    equipped = false,
    fields = {},
  }: {
    name: string;
    type?: string | null;
    description?: string | null;
    equipped?: boolean;
    fields?: Record<string, any>;
  },
) {
  const item = await inventoryDAO.create({
    characterId,
    name,
    type,
    description,
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
        equipped: item.equipped,
        fields,
      };
    }),
  );

  return enriched;
}

export async function getCharacterWithInventory(
  characterId: string,
): Promise<CharacterWithInventory | null> {
  const character = await characterDAO.findById(characterId);
  if (!character) return null;

  const inventory = await getInventory(characterId);

  return {
    id: character.id,
    name: character.name,
    inventory,
  };
}

export async function updateField(
  inventoryId: string,
  name: string,
  value: any,
  meta: Record<string, any> = {},
) {
  return fieldDAO.create(inventoryId, name, value, meta);
}

export async function updateFields(inventoryId: string, fieldMap: Record<string, any>) {
  return fieldDAO.bulkUpsert(inventoryId, fieldMap);
}

export async function deleteItem(inventoryId: string) {
  await fieldDAO.deleteByInventory(inventoryId);
  await inventoryDAO.deleteById(inventoryId);
}

export async function setEquipped(inventoryId: string, equipped: boolean) {
  return inventoryDAO.toggleEquipped(inventoryId, equipped);
}

export async function deleteInventoryByCharacter(characterId: string) {
  const items = await inventoryDAO.findByCharacter(characterId);
  for (const item of items) {
    await fieldDAO.deleteByInventory(item.id);
    await inventoryDAO.deleteById(item.id);
  }
}
