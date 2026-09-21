const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Simulate GET /:id route logic
async function testPriceCalc(orderId, factoryId) {
  const { calculateOrderPrice } = require('./src/services/pricingEngine');
  
  try {
    const price = await calculateOrderPrice(orderId, { factoryId });
    console.log('\n=== PRICE CALCULATION SUCCESS ===');
    console.log('Order Total:', price.order_total);
    console.log('Items:', price.items.length);
    price.items.forEach(i => console.log(`  ${i.garment_type}: unit_price=${i.unit_price}, margin=${(i.margin_pct*100).toFixed(1)}%`));
    return price;
  } catch (e) {
    console.log('\n=== PRICE CALCULATION FAILED ===');
    console.log('Error:', e.message);
    console.log('Stack:', e.stack);
    return null;
  }
}

async function main() {
  const f = await pool.query('SELECT id FROM factories LIMIT 1');
  const factoryId = f.rows[0].id;
  
  // Test with first order
  const orders = await pool.query('SELECT id FROM orders WHERE factory_id = $1 ORDER BY created_at DESC LIMIT 3', [factoryId]);
  
  for (const o of orders.rows) {
    console.log('\n\n========== ORDER:', o.id, '==========');
    await testPriceCalc(o.id, factoryId);
  }
  
  await pool.end();
}

main().catch(console.error);