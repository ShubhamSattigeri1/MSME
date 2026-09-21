const pool = require('../db');
const insertOrder = require('../db/insertOrder');
const { assertOneOf, assertUuid } = require('../utils/validation');
const pricingEngine = require('./pricingEngine');
const { getMultiplierMap, calculateRequiredQty } = require('./sizeMultiplierService');

const ORDER_STATUSES = ['pending', 'confirmed', 'in_production', 'shipped', 'cancelled'];

async function createOrder(payload, factoryId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    // NOTE: insertOrder must be updated to accept and insert factory_id
    const orderId = await insertOrder(client, payload, factoryId);

    const itemsRes = await client.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
    const items = itemsRes.rows;

    const multiplierMap = await getMultiplierMap(factoryId);
    const requirements = new Map();

    for (const item of items) {
      const sizeBreakdown = item.size_breakdown
        ? (typeof item.size_breakdown === 'string' ? JSON.parse(item.size_breakdown) : item.size_breakdown)
        : null;

      const bomRes = await client.query(
        `SELECT b.material_id, b.qty_per_unit, m.name AS material_name, m.qty_available, m.unit
         FROM bom b
         JOIN materials m ON m.id = b.material_id
         WHERE LOWER(b.garment_type) = LOWER($1) AND b.factory_id = $2 AND m.factory_id = $2 FOR UPDATE`,
        [item.garment_type, factoryId]
      );

      for (const row of bomRes.rows) {
        const requiredQty = calculateRequiredQty(Number(row.qty_per_unit), Number(item.quantity), sizeBreakdown, multiplierMap);
        const existing = requirements.get(row.material_id) || {
          material_id: row.material_id,
          material_name: row.material_name,
          required: 0,
          available: Number(row.qty_available),
          unit: row.unit,
        };
        existing.required += requiredQty;
        requirements.set(row.material_id, existing);
      }
    }

    const shortfalls = [];
    const auto_pos_raised = [];

    for (const req of requirements.values()) {
      if (req.required > req.available) {
        const deficit = Number((req.required - req.available).toFixed(4));
        shortfalls.push({
          material_id: req.material_id,
          material_name: req.material_name,
          required: Number(req.required.toFixed(4)),
          available: Number(req.available.toFixed(4)),
          deficit,
          unit: req.unit,
        });

        const bufferQty = Number((deficit * 1.1).toFixed(2));
        const poRes = await client.query(
          `INSERT INTO purchase_orders (material_id, qty_ordered, status, factory_id) VALUES ($1, $2, $3, $4) RETURNING id`,
          [req.material_id, bufferQty, 'pending', factoryId]
        );
        auto_pos_raised.push(poRes.rows[0].id);
      }
    }

    const material_status = {
      sufficient: shortfalls.length === 0,
      shortfalls,
      auto_pos_raised,
    };

    let price = null;
    try {
      price = await pricingEngine.calculateOrderPrice(orderId, { dbClient: client, factoryId });

      if (price && price.items && Array.isArray(price.items)) {
        for (const priceItem of price.items) {
          await client.query(
            `UPDATE order_items SET unit_price = $1 WHERE order_id = $2 AND garment_type = $3 AND factory_id = $4`,
            [priceItem.unit_price, orderId, priceItem.garment_type, factoryId]
          );
        }
        await client.query(
          `UPDATE orders SET price_breakdown = $1, total_price = $2 WHERE id = $3 AND factory_id = $4`,
          [JSON.stringify(price), price.order_total, orderId, factoryId]
        );
      }
    } catch (e) {
      console.error('[CREATE ORDER] Pricing calculation failed (order created without prices):', e.message);
    }

    await client.query('COMMIT');

    try {
      const { generateQuotation } = require('./quotationGenerator');
      await generateQuotation(orderId, factoryId);
    } catch (e) {
      console.error('[CREATE ORDER] Quotation generation failed:', e.message);
    }

    const order = await getOrderById(orderId, factoryId);
    return { ...order, price_breakdown: price, material_status };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listOrders(filters = {}, factoryId) {
  const clauses = ['factory_id = $1'];
  const values = [factoryId];

  if (filters.status) {
    assertOneOf(filters.status, ORDER_STATUSES, 'status');
    values.push(filters.status);
    clauses.push(`status = $${values.length}`);
  }

  if (filters.buyer_name) {
    values.push(`%${filters.buyer_name}%`);
    clauses.push(`buyer_name ILIKE $${values.length}`);
  }

  if (filters.from_date) {
    values.push(filters.from_date);
    clauses.push(`created_at >= $${values.length}`);
  }

  if (filters.source) {
    values.push(filters.source);
    clauses.push(`source = $${values.length}`);
  }

  const whereClause = `WHERE ${clauses.join(' AND ')}`;
  const result = await pool.query(`SELECT * FROM orders ${whereClause} ORDER BY created_at DESC`, values);
  return result.rows.map(row => {
    if (row && typeof row.price_breakdown === 'string') {
      try { row.price_breakdown = JSON.parse(row.price_breakdown); } catch { row.price_breakdown = null; }
    }
    return row;
  });
}

async function getOrderById(id, factoryId) {
  assertUuid(id, 'id');
  const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1 AND factory_id = $2', [id, factoryId]);

  if (orderResult.rowCount === 0) {
    return null;
  }

  const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1 AND factory_id = $2 ORDER BY id', [id, factoryId]);
  const order = orderResult.rows[0];
  if (order && typeof order.price_breakdown === 'string') {
    try { order.price_breakdown = JSON.parse(order.price_breakdown); } catch { order.price_breakdown = null; }
  }
  return { ...order, items: itemsResult.rows };
}

async function updateOrderStatus(id, status, factoryId) {
  assertUuid(id, 'id');
  assertOneOf(status, ORDER_STATUSES, 'status');

  const result = await pool.query(
    `UPDATE orders
     SET status = $1, updated_at = NOW()
     WHERE id = $2 AND factory_id = $3
     RETURNING *`,
    [status, id, factoryId]
  );

  const order = result.rows[0] || null;
  if (!order) return null;

  const itemsRes = await pool.query('SELECT * FROM order_items WHERE order_id = $1 AND factory_id = $2', [id, factoryId]);
  order.items = itemsRes.rows;

  // Mandatory SKU check before starting production
  if (status === 'in_production') {
    const skuCheck = await pool.query(
      'SELECT COUNT(*) AS cnt FROM order_items WHERE order_id = $1 AND factory_id = $2 AND sku_id IS NULL',
      [id, factoryId]
    );
    if (Number(skuCheck.rows[0].cnt) > 0) {
      throw new Error(
        `Cannot start production: ${skuCheck.rows[0].cnt} item(s) have no SKU assigned. ` +
        `Go to Pending Review > Unmatched SKU to resolve.`
      );
    }
  }

  try {
    if (status === 'confirmed') {
      const productionScheduler = require('./productionScheduler');
      const schedule = await productionScheduler.scheduleOrder(id, factoryId);

      const quotationRes = await pool.query(
        'SELECT * FROM quotations WHERE order_id = $1 AND factory_id = $2 ORDER BY created_at DESC LIMIT 1',
        [id, factoryId]
      );
      if (quotationRes.rowCount > 0) {
        const notifier = require('./notifier');
        await notifier.sendQuotationReady(order, quotationRes.rows[0]);
      }

      return { ...order, schedule, warning: schedule.deadline_feasible ? null : `Order cannot meet deadline. Expected: ${schedule.expected_completion}, Deadline: ${order.delivery_deadline}` };
    }

    if (status === 'in_production') {
      const productionScheduler = require('./productionScheduler');
      const stageResult = await productionScheduler.advanceStage(id, factoryId);

      const notifier = require('./notifier');
      await notifier.sendProductionStarted(order, { ...order, current_stage: stageResult.current_stage });
    }

    if (status === 'shipped') {
      const notifier = require('./notifier');
      await notifier.sendOrderShipped(order);
    }
  } catch (e) {
    console.error('[NOTIFY] Error in status change side effects:', e.message);
  }

  return order;
}

module.exports = {
  ORDER_STATUSES,
  createOrder,
  listOrders,
  getOrderById,
  updateOrderStatus,
};