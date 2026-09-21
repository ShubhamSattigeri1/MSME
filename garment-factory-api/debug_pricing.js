const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const f = await pool.query('SELECT id FROM factories LIMIT 1');
  const factoryId = f.rows[0].id;
  console.log('Factory:', factoryId);
  
  const orders = await pool.query('SELECT id, buyer_name FROM orders WHERE factory_id = $1 ORDER BY created_at DESC LIMIT 5', [factoryId]);
  for (const o of orders.rows) {
    console.log('\nOrder:', o.id, o.buyer_name);
    const items = await pool.query('SELECT garment_type, unit_price FROM order_items WHERE order_id = $1', [o.id]);
    console.log('Items:', JSON.stringify(items.rows));
  }
  
  const bom = await pool.query('SELECT garment_type, material_id, qty_per_unit FROM bom WHERE factory_id = $1', [factoryId]);
  console.log('\nBOM:', JSON.stringify(bom.rows));
  
  const mats = await pool.query('SELECT id, name, unit_cost, factory_id FROM materials WHERE factory_id = $1', [factoryId]);
  console.log('\nMaterials:', JSON.stringify(mats.rows));
  
  const ps = await pool.query('SELECT * FROM pricing_settings WHERE factory_id = $1', [factoryId]);
  console.log('\nPricing settings:', JSON.stringify(ps.rows));
  
  await pool.end();
}
check().catch(console.error);