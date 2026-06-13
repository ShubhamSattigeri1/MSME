const pool = require('../db');
const insertOrder = require('../db/insertOrder');
const { assertOneOf, assertUuid } = require('../utils/validation');
const pricingEngine = require('./pricingEngine');

// services used within transaction
const purchaseOrdersService = require('./purchaseOrders');

const ORDER_STATUSES = ['pending', 'confirmed', 'in_production', 'shipped', 'cancelled'];

async function createOrder(payload) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const orderId = await insertOrder(client, payload);

    // fetch inserted items
    const itemsRes = await client.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
    const items = itemsRes.rows;

    // material availability check & reservation within this transaction
    const requirements = new Map();

    for (const item of items) {
      const bomRes = await client.query(
        `SELECT b.material_id, b.qty_per_unit, m.name AS material_name, m.qty_available, m.unit
         FROM bom b
         JOIN materials m ON m.id = b.material_id
         WHERE b.garment_type = $1 FOR UPDATE`,
        [item.garment_type]
      );

      for (const row of bomRes.rows) {
        const requiredQty = Number(row.qty_per_unit) * Number(item.quantity);
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

        // auto-create purchase order for deficit * 1.1 buffer
        const bufferQty = Number((deficit * 1.1).toFixed(2));
        const poRes = await client.query(
          `INSERT INTO purchase_orders (material_id, qty_ordered, status) VALUES ($1, $2, $3) RETURNING id`,
          [req.material_id, bufferQty, 'pending']
        );
        auto_pos_raised.push(poRes.rows[0].id);
      }
    }

    const material_status = {
      sufficient: shortfalls.length === 0,
      shortfalls,
      auto_pos_raised,
    };

    // if sufficient, reserve materials by reducing qty_available
    if (shortfalls.length === 0) {
      for (const req of requirements.values()) {
        await client.query(
          `UPDATE materials SET qty_available = qty_available - $1, updated_at = NOW() WHERE id = $2`,
          [Number(req.required.toFixed(4)), req.material_id]
        );
      }
    }

    // calculate price and update orders.total_price within transaction
    const price = await pricingEngine.calculateOrderPrice(orderId, { dbClient: client });

    await client.query('COMMIT');

    const order = await getOrderById(orderId);
    // attach computed price breakdown and material status
    return { ...order, price_breakdown: price, material_status };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listOrders(filters = {}) {
  const clauses = [];
  const values = [];

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

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await pool.query(`SELECT * FROM orders ${whereClause} ORDER BY created_at DESC`, values);
  return result.rows;
}

async function getOrderById(id) {
  assertUuid(id, 'id');
  const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);

  if (orderResult.rowCount === 0) {
    return null;
  }

  const itemsResult = await pool.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [id]);
  return { ...orderResult.rows[0], items: itemsResult.rows };
}

async function updateOrderStatus(id, status) {
  assertUuid(id, 'id');
  assertOneOf(status, ORDER_STATUSES, 'status');

  const result = await pool.query(
    `UPDATE orders
     SET status = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [status, id]
  );

  const order = result.rows[0] || null;
  if (!order) return null;

  // Attach items for downstream services
  const itemsRes = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [id]);
  order.items = itemsRes.rows;

  try {
    if (status === 'confirmed') {
      // Auto-schedule production
      const productionScheduler = require('./productionScheduler');
      const schedule = await productionScheduler.scheduleOrder(id);

      // Send quotation email if quotation exists
      const quotationRes = await pool.query(
        'SELECT * FROM quotations WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1',
        [id]
      );
      if (quotationRes.rowCount > 0) {
        const notifier = require('./notifier');
        await notifier.sendQuotationReady(order, quotationRes.rows[0]);
      }

      return { ...order, schedule, warning: schedule.deadline_feasible ? null : `Order cannot meet deadline. Expected: ${schedule.expected_completion}, Deadline: ${order.delivery_deadline}` };
    }

    if (status === 'in_production') {
      // Update production schedule
      await pool.query(
        `UPDATE production_schedule SET current_stage = 'cutting', start_date = CURRENT_DATE, updated_at = NOW()
         WHERE order_id = $1 AND current_stage = 'queued'`,
        [id]
      );

      const notifier = require('./notifier');
      const scheduleRes = await pool.query(
        'SELECT * FROM production_schedule WHERE order_id = $1 ORDER BY updated_at DESC LIMIT 1',
        [id]
      );
      await notifier.sendProductionStarted(order, scheduleRes.rows[0] || {});
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
