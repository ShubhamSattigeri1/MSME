const pool = require('../db');

async function getMultiplierMap(factoryId) {
  const result = await pool.query(
    'SELECT size, multiplier FROM size_multipliers WHERE factory_id = $1',
    [factoryId]
  );
  const map = {};
  for (const row of result.rows) {
    map[row.size.toLowerCase()] = Number(row.multiplier);
  }
  return map;
}

function calculateRequiredQty(bomQtyPerUnit, itemQuantity, sizeBreakdown, multiplierMap) {
  if (!sizeBreakdown || typeof sizeBreakdown !== 'object' || Object.keys(sizeBreakdown).length === 0) {
    return bomQtyPerUnit * itemQuantity;
  }
  let total = 0;
  for (const [size, qty] of Object.entries(sizeBreakdown)) {
    const m = multiplierMap[size.toLowerCase()] ?? 1.0;
    total += bomQtyPerUnit * Number(qty) * m;
  }
  return total;
}

module.exports = { getMultiplierMap, calculateRequiredQty };
