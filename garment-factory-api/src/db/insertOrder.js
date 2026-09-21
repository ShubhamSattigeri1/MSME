const { assertPositiveNumber, assertRequired } = require('../utils/validation');
const { findOrCreateBuyer } = require('../services/buyers');

async function insertOrder(client, parsedOrder, factoryId) {
  parsedOrder.buyer_name = parsedOrder.buyer_name || 'Unknown';
  if (!Array.isArray(parsedOrder.items) || parsedOrder.items.length === 0) {
    throw new Error('items must contain at least one order item');
  }

  for (const item of parsedOrder.items) {
    assertRequired(item.garment_type, 'item.garment_type');
    assertPositiveNumber(item.quantity, 'item.quantity');
  }

  const orderResult = await client.query(
    `INSERT INTO orders (buyer_name, buyer_contact, delivery_deadline, total_price, notes, source, factory_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      parsedOrder.buyer_name,
      parsedOrder.buyer_contact || null,
      parsedOrder.delivery_deadline || null,
      parsedOrder.total_price || null,
      parsedOrder.notes || parsedOrder.special_instructions || null,
      parsedOrder.source || 'manual',
      factoryId,
    ]
  );

  const orderId = orderResult.rows[0].id;

  // Auto-link or create buyer profile
  let buyerEmail = null;
  let buyerPhone = null;

  const contact = parsedOrder.buyer_contact || '';
  if (contact.includes('@')) {
    buyerEmail = contact;
  } else if (contact && contact.match(/^[\d\+\-\s]+$/)) {
    buyerPhone = contact;
  }

  if (!buyerEmail && parsedOrder.buyer_email) {
    buyerEmail = parsedOrder.buyer_email;
  }

  const buyer = await findOrCreateBuyer({
    name: parsedOrder.buyer_name,
    email: buyerEmail,
    phone: buyerPhone,
  }, factoryId);

  await client.query(
    'UPDATE orders SET buyer_id = $1::uuid WHERE id = $2::uuid AND factory_id = $3::uuid',
    [buyer.id, orderId, factoryId]
  );

  if (buyerEmail) {
    await client.query(
      'UPDATE orders SET buyer_contact = $1 WHERE id = $2::uuid AND factory_id = $3::uuid',
      [buyerEmail, orderId, factoryId]
    );
  }

  for (const item of parsedOrder.items) {
    await client.query(
      `INSERT INTO order_items
         (order_id, garment_type, fabric_type, colour, quantity, size_breakdown, unit_price, special_notes, factory_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        orderId,
        item.garment_type,
        item.fabric_type || null,
        item.colour || null,
        item.quantity,
        item.size_breakdown ? JSON.stringify(item.size_breakdown) : null,
        item.unit_price || null,
        item.special_notes || null,
        factoryId,
      ]
    );
  }

  return orderId;
}

module.exports = insertOrder;
