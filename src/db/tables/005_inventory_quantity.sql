ALTER TABLE character_inventory
  ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;

ALTER TABLE character_inventory
  DROP CONSTRAINT IF EXISTS character_inventory_quantity_positive;

ALTER TABLE character_inventory
  ADD CONSTRAINT character_inventory_quantity_positive CHECK (quantity > 0);
