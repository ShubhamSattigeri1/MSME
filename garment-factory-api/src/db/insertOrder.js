const { assertPositiveNumber, assertRequired } = require('../utils/validation');
const { findOrCreateBuyer } = require('../services/buyers');

async function insertOrder(client, parsedOrder) {
  parsedOrder.buyer_name = parsedOrder.buyer_name || 'Unknown';
  if (!Array.isArray(parsedOrder.items) || parsedOrder.items.length === 0) {
    throw new Error('items must contain at least one order item');
  }

  for (const item of parsedOrder.items) {
    assertRequired(item.garment_type, 'item.garment_type');
    assertPositiveNumber(item.quantity, 'item.quantity');
  }

  const orderResult = await client.query(
    `INSERT INTO orders (buyer_name, buyer_contact, delivery_deadline, total_price, notes, source)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      parsedOrder.buyer_name,
      parsedOrder.buyer_contact || null,
      parsedOrder.delivery_deadline || null,
      parsedOrder.total_price || null,
      parsedOrder.notes || parsedOrder.special_instructions || null,
      parsedOrder.source || 'manual',
    ]
  );

  const orderId = orderResult.rows[0].id;

  // Auto-link or create buyer profile
  const contact = parsedOrder.buyer_contact || '';
  const buyer = await findOrCreateBuyer({
    name: parsedOrder.buyer_name,
    email: contact.includes('@') ? contact : null,
    phone: !contact.includes('@') && contact ? contact : null,
  });

  await client.query(
    'UPDATE orders SET buyer_id = $1::uuid WHERE id = $2::uuid',
    [buyer.id, orderId]
  );

  for (const item of parsedOrder.items) {
    await client.query(
      `INSERT INTO order_items
         (order_id, garment_type, fabric_type, colour, quantity, size_breakdown, unit_price, special_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        orderId,
        item.garment_type,
        item.fabric_type || null,
        item.colour || null,
        item.quantity,
        item.size_breakdown ? JSON.stringify(item.size_breakdown) : null,
        item.unit_price || null,
        item.special_notes || null,
      ]
    );
  }

  return orderId;
}

module.exports = insertOrder;
