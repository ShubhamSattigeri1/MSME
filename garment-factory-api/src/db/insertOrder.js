const { assertPositiveNumber, assertRequired } = require('../utils/validation');

async function insertOrder(client, parsedOrder) {
  assertRequired(parsedOrder.buyer_name, 'buyer_name');
  if (!Array.isArray(parsedOrder.items) || parsedOrder.items.length === 0) {
    throw new Error('items must contain at least one order item');
  }

  for (const item of parsedOrder.items) {
    assertRequired(item.garment_type, 'item.garment_type');
    assertPositiveNumber(item.quantity, 'item.quantity');
  }

  const orderResult = await client.query(
    `INSERT INTO orders (buyer_name, buyer_contact, delivery_deadline, total_price, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      parsedOrder.buyer_name,
      parsedOrder.buyer_contact || null,
      parsedOrder.delivery_deadline || null,
      parsedOrder.total_price || null,
      parsedOrder.notes || parsedOrder.special_instructions || null,
    ]
  );

  const orderId = orderResult.rows[0].id;

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
