const pool = require('../db');

const SIZE_ALIASES = {
  s: 'small',
  m: 'medium',
  l: 'large',
  xl: 'extra_large',
  xxl: 'extra_extra_large',
  '3xl': 'triple_extra_large',
  small: 'small',
  medium: 'medium',
  large: 'large',
  'extra large': 'extra_large',
  'extra extra large': 'extra_extra_large',
};

function normalizeSize(size) {
  if (!size) return size;
  return SIZE_ALIASES[String(size).trim().toLowerCase()] || String(size).trim().toLowerCase();
}

/**
 * Resolve a SKU ID from (garment_type, size, color, material) attributes.
 * Returns the sku record or null if not found.
 */
async function resolveSKU({ garment_type, size, color, material }, factoryId) {
  const result = await pool.query(
    `SELECT * FROM product_skus WHERE factory_id = $1 AND active = 1`,
    [factoryId]
  );
  for (const sku of result.rows) {
    const attrs = typeof sku.attribute_set === 'string' ? JSON.parse(sku.attribute_set) : sku.attribute_set;
    if (attrs.garment_type === garment_type
      && normalizeSize(attrs.size) === normalizeSize(size)
      && attrs.color === color
      && attrs.material === material) {
      return sku;
    }
  }
  return null;
}

/**
 * Get BOM (material requirements) for a given SKU.
 * Returns [{ material_id, qty_per_unit, unit, material_name, qty_available }]
 */
async function getSKUBOM(skuId, factoryId) {
  const result = await pool.query(
    `SELECT b.material_id, b.qty_per_unit, b.unit, m.name AS material_name, m.qty_available, m.minimum_qty, m.reorder_factor
     FROM bom_sku b
     JOIN materials m ON m.id = b.material_id
     WHERE b.sku_id = $1 AND b.factory_id = $2 AND m.factory_id = $2`,
    [skuId, factoryId]
  );
  return result.rows;
}

/**
 * List all active SKUs with their BOM summary for a factory.
 */
async function listSKUs(factoryId) {
  const skus = await pool.query(
    `SELECT * FROM product_skus WHERE factory_id = $1 ORDER BY sku_code`,
    [factoryId]
  );

  for (const sku of skus.rows) {
    const bom = await getSKUBOM(sku.id, factoryId);
    sku.bom = bom;
    sku.attribute_set = typeof sku.attribute_set === 'string'
      ? JSON.parse(sku.attribute_set)
      : sku.attribute_set;
    sku.attributes = sku.attribute_set;
  }

  return skus.rows;
}

/**
 * Create or update a SKU with its BOM entries.
 */
async function upsertSKU({ skuCode, attributeSet, bomEntries, factoryId }) {
  // Upsert SKU
  const existing = await pool.query(
    `SELECT id FROM product_skus WHERE sku_code = $1 AND factory_id = $2`,
    [skuCode, factoryId]
  );

  let skuId;
  if (existing.rowCount > 0) {
    skuId = existing.rows[0].id;
    await pool.query(
      `UPDATE product_skus SET attribute_set = $1 WHERE id = $2`,
      [JSON.stringify(attributeSet), skuId]
    );
  } else {
    const result = await pool.query(
      `INSERT INTO product_skus (factory_id, sku_code, attribute_set) VALUES ($1, $2, $3) RETURNING *`,
      [factoryId, skuCode, JSON.stringify(attributeSet)]
    );
    skuId = result.rows[0].id;
  }

  // Upsert BOM entries
  for (const entry of (bomEntries || [])) {
    const existingBom = await pool.query(
      `SELECT id FROM bom_sku WHERE sku_id = $1 AND material_id = $2`,
      [skuId, entry.material_id]
    );
    if (existingBom.rowCount > 0) {
      await pool.query(
        `UPDATE bom_sku SET qty_per_unit = $1, unit = $2 WHERE id = $3`,
        [entry.qty_per_unit, entry.unit, existingBom.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO bom_sku (sku_id, material_id, qty_per_unit, unit, factory_id) VALUES ($1, $2, $3, $4, $5)`,
        [skuId, entry.material_id, entry.qty_per_unit, entry.unit, factoryId]
      );
    }
  }

  return { id: skuId, sku_code: skuCode };
}

/**
 * Check whether a SKU's attributes match an order item.
 * item: { garment_type, colour, fabric_type, size_breakdown }
 * Returns { match: boolean, mismatches: string[] }
 */
function skuMatchesItem(sku, item) {
  const attrs = typeof sku.attribute_set === 'string'
    ? JSON.parse(sku.attribute_set)
    : (sku.attribute_set || {});
  const mismatches = [];

  if (attrs.garment_type && item.garment_type
    && String(attrs.garment_type).trim().toLowerCase() !== String(item.garment_type).trim().toLowerCase()) {
    mismatches.push(`garment_type (SKU: ${attrs.garment_type}, order: ${item.garment_type})`);
  }
  if (attrs.color && item.colour
    && String(attrs.color).trim().toLowerCase() !== String(item.colour).trim().toLowerCase()) {
    mismatches.push(`color (SKU: ${attrs.color}, order: ${item.colour})`);
  }
  if (attrs.material && item.fabric_type
    && String(attrs.material).trim().toLowerCase() !== String(item.fabric_type).trim().toLowerCase()) {
    mismatches.push(`material (SKU: ${attrs.material}, order: ${item.fabric_type})`);
  }
  if (attrs.size && item.size_breakdown) {
    const sb = typeof item.size_breakdown === 'string'
      ? JSON.parse(item.size_breakdown)
      : item.size_breakdown;
    const sizes = Object.keys(sb || {});
    if (sizes.length > 0 && !sizes.some((s) => normalizeSize(s) === normalizeSize(attrs.size))) {
      mismatches.push(`size (SKU: ${attrs.size}, order: ${sizes.join(', ')})`);
    }
  }

  return { match: mismatches.length === 0, mismatches };
}

module.exports = { resolveSKU, getSKUBOM, listSKUs, upsertSKU, normalizeSize, skuMatchesItem };
