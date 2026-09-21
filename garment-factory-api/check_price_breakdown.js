const { Pool } = require('pg');
require('dotenv').config({ path: '.env' });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
  const f = await pool.query('SELECT id FROM factories LIMIT 1');
  const factoryId = f.rows[0].id;
  console.log('Factory:', factoryId);
  
  const orders = await pool.query(
    'SELECT id, buyer_name, total_price, price_breakdown FROM orders WHERE factory_id = $1 ORDER BY created_at DESC LIMIT 5', 
    [factoryId]
  );
  
  for (const o of orders.rows) {
    console.log('\nOrder:', o.id, o.buyer_name);
    console.log('total_price:', o.total_price);
    console.log('price_breakdown:', o.price_breakdown ? 'EXISTS (keys: ' + Object.keys(o.price_breakdown).join(', ') + ')' : 'NULL');
    if (o.price_breakdown) {
      console.log('  order_total:', o.price_breakdown.order_total);
      console.log('  items count:', o.price_breakdown.items?.length || 0);
      if (o.price_breakdown.items && o.price_breakdown.items.length > 0) {
        console.log('  first item:', o.price_breakdown.items[0]);
      }
    }
  }
  
  await pool.end();
}
check().catch(console.error);