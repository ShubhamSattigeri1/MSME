const express = require('express');
const {
  createOrder,
  getOrderById,
  listOrders,
  updateOrderStatus,
} = require('../services/orders');

const pricingEngine = require('../services/pricingEngine');
const quotationService = require('../services/quotationGenerator');
const negotiationService = require('../services/negotiation');
const { suggestDeadline } = require('../services/deadlineEngine');

const router = express.Router();

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

router.get('/', async (req, res, next) => {
  try {
    return success(res, await listOrders(req.query, req.factoryId));
  } catch (err) {
    return next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const result = await createOrder(req.body, req.factoryId);
    return success(res, result, 201);
  } catch (err) {
    return next(err);
  }
});

router.get('/export/excel', async (req, res, next) => {
  try {
    const ExcelJS = require('exceljs');
    const pool = require('../db');
    const factoryId = req.factoryId;

    const factoryRes = await pool.query('SELECT slug, name FROM factories WHERE id = $1', [factoryId]);
    const factorySlug = factoryRes.rowCount > 0 ? factoryRes.rows[0].slug || factoryRes.rows[0].name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() : 'factory';

    const result = await pool.query(
      `SELECT o.id, o.buyer_name, o.delivery_deadline, o.status, o.source, o.created_at,
              oi.garment_type, oi.quantity, oi.unit_price, oi.colour, oi.fabric_type,
              oi.unit_price * oi.quantity AS total_price
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       WHERE o.factory_id = $1
       ORDER BY o.created_at DESC, oi.id`,
      [factoryId]
    );

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Orders');

    worksheet.columns = [
      { header: 'Order ID', key: 'id', width: 36 },
      { header: 'Buyer Name', key: 'buyer_name', width: 24 },
      { header: 'Garment Type', key: 'garment_type', width: 20 },
      { header: 'Colour', key: 'colour', width: 14 },
      { header: 'Fabric', key: 'fabric_type', width: 16 },
      { header: 'Quantity', key: 'quantity', width: 10 },
      { header: 'Unit Price (₹)', key: 'unit_price', width: 16 },
      { header: 'Total Price (₹)', key: 'total_price', width: 18 },
      { header: 'Delivery Deadline', key: 'delivery_deadline', width: 16 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Order Date', key: 'created_at', width: 16 },
      { header: 'Source', key: 'source', width: 14 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

    let rowIndex = 2;
    for (const row of result.rows) {
      const excelRow = worksheet.addRow({
        id: row.id,
        buyer_name: row.buyer_name || '',
        garment_type: row.garment_type || '',
        colour: row.colour || '',
        fabric_type: row.fabric_type || '',
        quantity: row.quantity || 0,
        unit_price: row.unit_price != null ? Number(row.unit_price) : '',
        total_price: row.total_price != null ? Number(row.total_price) : '',
        delivery_deadline: row.delivery_deadline ? new Date(row.delivery_deadline).toLocaleDateString('en-IN') : '',
        status: row.status || '',
        created_at: row.created_at ? new Date(row.created_at).toLocaleDateString('en-IN') : '',
        source: row.source || '',
      });

      if (row.unit_price != null) {
        excelRow.getCell('G').numFmt = '#,##0.00';
      }
      if (row.total_price != null) {
        excelRow.getCell('H').numFmt = '#,##0.00';
      }

      if (rowIndex % 2 === 0) {
        excelRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
      rowIndex += 1;
    }

    const today = new Date().toISOString().slice(0, 10);
    const filename = `orders_${factorySlug}_${today}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(await workbook.xlsx.writeBuffer());
  } catch (err) {
    return next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const order = await getOrderById(req.params.id, req.factoryId);

    if (!order) {
      return res.status(404).json({ success: false, error: 'order not found' });
    }

    try {
      const price = await pricingEngine.calculateOrderPrice(req.params.id, { factoryId: req.factoryId });
      if (price && price.items && Array.isArray(price.items)) {
        const pool = require('../db');
        for (const item of price.items) {
          await pool.query(
            `UPDATE order_items SET unit_price = $1 WHERE id = $2 AND factory_id = $3`,
            [item.unit_price, item.order_item_id, req.factoryId]
          );
        }
      }
      return success(res, { ...order, price_breakdown: price });
    } catch (e) {
      console.error(`[PRICING] Failed to calculate price for order ${req.params.id}:`, e.message);
      return success(res, order);
    }
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/quotation', async (req, res, next) => {
  try {
    const q = await quotationService.generateQuotation(req.params.id, req.factoryId);
    return success(res, q, 201);
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/send-quotation', async (req, res, next) => {
  try {
    const pool = require('../db');
    const { sendEmail } = require('../services/gmailSender');
    const factoryId = req.factoryId;

    const gmailRes = await pool.query(
      'SELECT email FROM gmail_connections WHERE factory_id = $1 LIMIT 1',
      [factoryId]
    );
    if (gmailRes.rowCount === 0) {
      return res.status(400).json({ success: false, error: 'Please connect your Gmail in Settings before sending quotations' });
    }
    const gmailEmail = gmailRes.rows[0].email;

    const order = await getOrderById(req.params.id, factoryId);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    const buyerRes = await pool.query(
      'SELECT email FROM buyers WHERE id = $1 AND factory_id = $2',
      [order.buyer_id, factoryId]
    );
    let buyerEmail = (buyerRes.rowCount > 0) ? buyerRes.rows[0].email : null;
    if (!buyerEmail && order.buyer_contact && order.buyer_contact.includes('@')) {
      buyerEmail = order.buyer_contact;
    }
    if (!buyerEmail) {
      return res.status(400).json({ success: false, error: 'Buyer email not available. Please add an email to the buyer profile.' });
    }

    let quotation = await quotationService.getLastQuotation(req.params.id, factoryId);
    if (!quotation) {
      quotation = await quotationService.generateQuotation(req.params.id, factoryId);
    }

    const qData = typeof quotation.data === 'string' ? JSON.parse(quotation.data) : quotation.data;

    const factoryRes = await pool.query('SELECT name FROM factories WHERE id = $1', [factoryId]);
    const factoryName = factoryRes.rowCount > 0 ? factoryRes.rows[0].name : 'Our Team';

    const emailSubject = `Quotation #${quotation.quotation_number} from ${factoryName}`;

    const itemLines = (qData.items || []).map(item =>
      `- ${item.garment_type} (${item.quantity} pcs) x ₹${Number(item.unit_price || 0).toLocaleString('en-IN')}/pc = ₹${Number(item.item_total || 0).toLocaleString('en-IN')}`
    ).join('\n');

    const subtotal = Number(qData.subtotal || 0);
    const tax = Number(qData.tax_amount || 0);
    const grandTotal = Number(qData.grand_total || order.total_price || 0);

    const emailBody = [
      `Dear ${order.buyer_name},`,
      '',
      `Please find your quotation for order #${order.id.slice(0, 8).toUpperCase()}.`,
      '',
      `Quotation Number: ${quotation.quotation_number}`,
      '',
      'Items:',
      itemLines || '  (no items)',
      '',
      `Subtotal: ₹${subtotal.toLocaleString('en-IN')}`,
      `GST (18%): ₹${tax.toLocaleString('en-IN')}`,
      `Grand Total: ₹${grandTotal.toLocaleString('en-IN')}`,
      '',
      'Please review and confirm at:',
      `${qData.confirm_url || ''}`,
      '',
      'Best regards,',
      factoryName,
    ].join('\n');

    const sent = await sendEmail({
      factoryId,
      from: gmailEmail,
      to: buyerEmail,
      subject: emailSubject,
      body: emailBody,
    });

    if (sent.threadId) {
      await pool.query(
        'UPDATE orders SET thread_id = $1 WHERE id = $2',
        [sent.threadId, req.params.id]
      );
    }

    await pool.query(
      `INSERT INTO messages (order_id, sender_type, sender_id, body, message_type, factory_id)
       VALUES ($1, 'owner', 'system', $2, 'text', $3)`,
      [req.params.id, emailBody, factoryId]
    );

    await pool.query('UPDATE quotations SET sent_at = NOW() WHERE id = $1', [quotation.id]);

    return success(res, { quotation_number: quotation.quotation_number, sent: true, thread_id: sent.threadId });
  } catch (err) {
    return next(err);
  }
});

router.get('/:id/quotation', async (req, res, next) => {
  try {
    const q = await quotationService.getLastQuotation(req.params.id, req.factoryId);
    if (!q) return res.status(404).json({ success: false, error: 'quotation not found' });
    return success(res, q);
  } catch (err) {
    return next(err);
  }
});

router.put('/:id/status', async (req, res, next) => {
  try {
    const order = await updateOrderStatus(req.params.id, req.body.status, req.factoryId);

    if (!order) {
      return res.status(404).json({ success: false, error: 'order not found' });
    }

    return success(res, order);
  } catch (err) {
    return next(err);
  }
});

// PUT /api/orders/:id/refine — refine order items with SKU info
router.put('/:id/refine', async (req, res, next) => {
  try {
    const { items, override } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items array required' });
    }

    const pool = require('../db');

    // Verify order belongs to this factory
    const orderRes = await pool.query(
      'SELECT id, status FROM orders WHERE id = $1 AND factory_id = $2',
      [req.params.id, req.factoryId]
    );
    if (orderRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const { skuMatchesItem } = require('../services/skuResolver');
    const mismatchWarnings = [];

    // Update each item with sku_id (accepts sku UUID id or sku_code)
    for (const item of items) {
      if (!item.order_item_id) continue;

      let skuId = null;
      if (item.sku_id) {
        const skuRes = await pool.query(
          'SELECT id, sku_code, attribute_set FROM product_skus WHERE (id = $1 OR sku_code = $1) AND factory_id = $2 AND active = 1',
          [item.sku_id, req.factoryId]
        );
        if (skuRes.rowCount === 0) {
          return res.status(400).json({ success: false, error: `SKU "${item.sku_id}" not found` });
        }
        skuId = skuRes.rows[0].id;

        // Attribute-match validation: warn unless override is set
        if (!override) {
          const itemRes = await pool.query(
            `SELECT garment_type, colour, fabric_type, size_breakdown FROM order_items WHERE id = $1 AND order_id = $2`,
            [item.order_item_id, req.params.id]
          );
          const orderItem = itemRes.rows[0];
          const { match, mismatches } = skuMatchesItem(skuRes.rows[0], orderItem || {});
          if (!match) {
            return res.status(409).json({
              success: false,
              error: `SKU ${skuRes.rows[0].sku_code} does not match this item: ${mismatches.join('; ')}. Set override: true to force-assign.`,
              code: 'SKU_MISMATCH',
              mismatches,
              order_item_id: item.order_item_id,
              sku_code: skuRes.rows[0].sku_code,
            });
          }
        }
      }

      await pool.query(
        `UPDATE order_items SET sku_id = $1 WHERE id = $2 AND order_id = $3`,
        [skuId, item.order_item_id, req.params.id]
      );
    }

    return success(res, { refined: true, warned: mismatchWarnings });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/negotiate', async (req, res, next) => {
  try {
    const { margin_pct, notes, items } = req.body || {};

    // Per-item margins mode
    const usingPerItem = Array.isArray(items) && items.length > 0;

    if (usingPerItem) {
      for (const entry of items) {
        if (!entry.order_item_id || entry.margin_pct === undefined || entry.margin_pct === null) {
          return res.status(400).json({ success: false, error: 'Each item must have order_item_id and margin_pct' });
        }
        const val = Number(entry.margin_pct);
        if (isNaN(val) || val < 0 || val > 1) {
          return res.status(400).json({ success: false, error: `margin_pct for item ${entry.order_item_id} must be between 0 and 1` });
        }
      }
    } else {
      if (margin_pct === undefined || margin_pct === null) {
        return res.status(400).json({ success: false, error: 'margin_pct is required when items not provided' });
      }
      const marginVal = Number(margin_pct);
      if (isNaN(marginVal) || marginVal < 0 || marginVal > 1) {
        return res.status(400).json({ success: false, error: 'margin_pct must be a number between 0 and 1' });
      }
    }

    const order = await getOrderById(req.params.id, req.factoryId);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.status === 'shipped' || order.status === 'cancelled') {
      return res.status(400).json({ success: false, error: `Cannot negotiate a ${order.status} order` });
    }

    const marginVal = usingPerItem ? null : Number(margin_pct);
    const result = await negotiationService.applyNegotiatedMargin(req.params.id, marginVal, notes || null, req.factoryId, usingPerItem ? items : null);
    return success(res, result);
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/negotiate/reset', async (req, res, next) => {
  try {
    const result = await negotiationService.resetMargin(req.params.id, req.factoryId);
    return success(res, result);
  } catch (err) {
    return next(err);
  }
});

router.get('/:id/negotiate/history', async (req, res, next) => {
  try {
    const history = await negotiationService.getNegotiationHistory(req.params.id, req.factoryId);
    return success(res, history);
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/propose-price', async (req, res, next) => {
  try {
    const { items, notes } = req.body || {};
    const pool = require('../db');
    const factoryId = req.factoryId;

    const order = await getOrderById(req.params.id, factoryId);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    if (order.status === 'shipped' || order.status === 'cancelled') {
      return res.status(400).json({ success: false, error: `Cannot propose price for a ${order.status} order` });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items array is required with at least one item' });
    }

    const pendingCheck = await pool.query(
      "SELECT id FROM messages WHERE order_id = $1 AND factory_id = $2 AND message_type = 'price_proposal' AND proposal_status = 'pending'",
      [req.params.id, factoryId]
    );
    if (pendingCheck.rowCount > 0) {
      return res.status(400).json({ success: false, error: 'A price proposal is already pending — buyer must accept or reject first' });
    }

    const settingsRes = await pool.query('SELECT minimum_margin_pct FROM pricing_settings WHERE factory_id = $1 ORDER BY updated_at DESC LIMIT 1', [factoryId]);
    const minimumMarginPct = Number(settingsRes.rows[0]?.minimum_margin_pct ?? 0.05);

    const itemMargins = {};
    for (const item of items) {
      if (!item.order_item_id) return res.status(400).json({ success: false, error: 'Each item must have an order_item_id' });
      const marginVal = Number(item.margin_pct);
      if (isNaN(marginVal) || marginVal < 0 || marginVal > 1) {
        return res.status(400).json({ success: false, error: `margin_pct for item ${item.order_item_id} must be between 0 and 1` });
      }
      if (marginVal < minimumMarginPct) {
        return res.status(400).json({ success: false, error: `Margin for ${item.garment_type || item.order_item_id} cannot be below minimum floor: ${(minimumMarginPct * 100).toFixed(1)}%` });
      }
      itemMargins[item.order_item_id] = marginVal;
    }

    const currentPrice = await pricingEngine.calculateOrderPrice(req.params.id, { factoryId });

    const proposalItems = currentPrice.items.map((cp) => {
      const proposedMargin = itemMargins[cp.order_item_id] ?? cp.margin_pct;
      const costBeforeMargin = cp.material_cost + cp.wastage_cost + cp.labour_cost + cp.overhead_cost;
      const proposedTotal = costBeforeMargin * (1 + proposedMargin);
      return {
        order_item_id: cp.order_item_id,
        garment_type: cp.garment_type,
        quantity: cp.quantity,
        original_unit_price: cp.unit_price,
        original_item_total: cp.item_total,
        proposed_margin_pct: proposedMargin,
        proposed_unit_price: Number((proposedTotal / cp.quantity).toFixed(2)),
        proposed_item_total: Number(proposedTotal.toFixed(2)),
      };
    });

    const originalTotal = currentPrice.order_total;
    const proposedTotal = proposalItems.reduce((s, i) => s + i.proposed_item_total, 0);

    const proposalData = {
      items: proposalItems,
      original_total: originalTotal,
      proposed_total: proposedTotal,
      notes: notes || null,
    };

    const itemLines = proposalItems.map(
      (i) => `  ${i.garment_type} (${i.quantity} pcs): ₹${i.original_unit_price} → ₹${i.proposed_unit_price}/pc`
    ).join('\n');

    const msgBody = `Price proposal per item:\n${itemLines}\n\nTotal: ₹${originalTotal.toLocaleString('en-IN')} → ₹${proposedTotal.toLocaleString('en-IN')}${notes ? '\nNote: ' + notes : ''}`;

    const msgRes = await pool.query(
      `INSERT INTO messages (order_id, sender_type, sender_id, body, message_type, proposal_data, proposal_status, factory_id)
       VALUES ($1, 'owner', 'system', $2, 'price_proposal', $3, 'pending', $4)
       RETURNING *`,
      [req.params.id, msgBody, JSON.stringify(proposalData), factoryId]
    );

    return success(res, { message: msgRes.rows[0], proposed_total: proposedTotal });
  } catch (err) {
    return next(err);
  }
});

router.post('/:id/email-negotiate', async (req, res, next) => {
  try {
    const { message, proposed_total } = req.body || {};
    const pool = require('../db');
    const { sendEmail } = require('../services/gmailSender');
    const factoryId = req.factoryId;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, error: 'message is required' });
    }
    const proposedTotal = Number(proposed_total);
    if (isNaN(proposedTotal) || proposedTotal <= 0) {
      return res.status(400).json({ success: false, error: 'proposed_total must be a positive number' });
    }

    const order = await getOrderById(req.params.id, factoryId);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    const gmailRes = await pool.query(
      'SELECT email FROM gmail_connections WHERE factory_id = $1 LIMIT 1',
      [factoryId]
    );
    if (gmailRes.rowCount === 0) {
      return res.status(400).json({ success: false, error: 'Please connect your Gmail in Settings before sending negotiation emails' });
    }
    const gmailEmail = gmailRes.rows[0].email;

    const buyerRes = await pool.query(
      'SELECT email, name FROM buyers WHERE id = $1 AND factory_id = $2',
      [order.buyer_id, factoryId]
    );
    let buyerEmail = (buyerRes.rowCount > 0) ? buyerRes.rows[0].email : null;
    let buyerName = (buyerRes.rowCount > 0) ? buyerRes.rows[0].name : null;
    if (!buyerEmail && order.buyer_contact && order.buyer_contact.includes('@')) {
      buyerEmail = order.buyer_contact;
    }
    if (!buyerEmail) {
      return res.status(400).json({ success: false, error: 'Buyer email not available. Please add an email to the buyer profile.' });
    }
    const buyer = { email: buyerEmail, name: buyerName };

    const factoryRes = await pool.query('SELECT name FROM factories WHERE id = $1', [factoryId]);
    const factoryName = factoryRes.rowCount > 0 ? factoryRes.rows[0].name : 'Our Team';

    const emailSubject = `Re: Your Order #${order.id.slice(0, 8).toUpperCase()} - Price Proposal`;
    const emailBody = `Dear ${order.buyer_name},\n\nThank you for your order. We'd like to propose the following:\n\n${message}\n\nProposed total: ₹${proposedTotal.toLocaleString('en-IN')}\n\nPlease reply to this email to accept or reject this proposal.\n\nBest regards,\n${factoryName}`;

    const sent = await sendEmail({
      factoryId,
      from: gmailEmail,
      to: buyer.email,
      subject: emailSubject,
      body: emailBody,
      threadId: order.thread_id || undefined,
    });

    if (sent.threadId && !order.thread_id) {
      await pool.query(
        'UPDATE orders SET thread_id = $1 WHERE id = $2',
        [sent.threadId, req.params.id]
      );
    }

    const proposalData = { proposed_total: proposedTotal, message };

    const msgRes = await pool.query(
      `INSERT INTO messages (order_id, sender_type, sender_id, body, message_type, proposal_data, proposal_status, factory_id)
       VALUES ($1, 'owner', 'system', $2, 'price_proposal', $3, 'pending', $4)
       RETURNING *`,
      [req.params.id, emailBody, JSON.stringify(proposalData), factoryId]
    );

    return res.json({
      success: true,
      data: {
        message_id: sent.messageId,
        thread_id: sent.threadId,
        proposed_total: proposedTotal,
        record: msgRes.rows[0],
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/:orderId/messages/:messageId/respond', async (req, res, next) => {
  try {
    const { action, notes } = req.body || {};
    const pool = require('../db');
    const factoryId = req.factoryId;

    if (!action || !['accept', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, error: 'action must be "accept" or "reject"' });
    }

    const msgRes = await pool.query(
      "SELECT * FROM messages WHERE id = $1 AND order_id = $2 AND factory_id = $3 AND message_type = 'price_proposal'",
      [req.params.messageId, req.params.orderId, factoryId]
    );
    if (msgRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Price proposal not found' });
    }
    const proposal = msgRes.rows[0];
    if (proposal.proposal_status !== 'pending') {
      return res.status(400).json({ success: false, error: 'This proposal has already been responded to' });
    }

    const pData = typeof proposal.proposal_data === 'string' ? JSON.parse(proposal.proposal_data) : proposal.proposal_data;

    if (action === 'accept') {
      await pool.query("UPDATE messages SET proposal_status = 'accepted' WHERE id = $1 AND factory_id = $2", [proposal.id, factoryId]);

      const itemMargins = {};
      for (const pi of (pData.items || [])) {
        itemMargins[pi.order_item_id] = pi.proposed_margin_pct;
      }
      await pricingEngine.calculateOrderPrice(req.params.orderId, { item_margins: itemMargins, factoryId });

      const avgMargin = pData.items && pData.items.length
        ? Number((pData.items.reduce((s, i) => s + Number(i.proposed_margin_pct), 0) / pData.items.length).toFixed(4))
        : null;
      await pool.query(
        "UPDATE orders SET status = 'confirmed', negotiated_margin_pct = $1, updated_at = NOW() WHERE id = $2 AND factory_id = $3",
        [avgMargin, req.params.orderId, factoryId]
      );

      const newTotal = pData.proposed_total;
      await require('../services/messaging').sendMessage(req.params.orderId, 'owner', `Price proposal accepted. New total: ₹${newTotal.toLocaleString('en-IN')}.`, { senderId: 'system', factoryId });

      const updatedOrder = await getOrderById(req.params.orderId, factoryId);
      let priceBreakdown = null;
      try {
        priceBreakdown = await pricingEngine.calculateOrderPrice(req.params.orderId, { item_margins: itemMargins, factoryId });
      } catch (e) { /* non-critical */ }

      try {
        const { getIO } = require('../socket');
        const io = getIO();
        if (io) {
          io.to(`order_${req.params.orderId}`).emit('order_updated', { order: { ...updatedOrder, price_breakdown: priceBreakdown } });
        }
      } catch (e) { /* non-critical */ }

      return success(res, {
        action,
        message_id: proposal.id,
        order: { ...updatedOrder, price_breakdown: priceBreakdown },
        new_total_price: newTotal,
      });
    } else {
      await pool.query("UPDATE messages SET proposal_status = 'rejected' WHERE id = $1 AND factory_id = $2", [proposal.id, factoryId]);
      await require('../services/messaging').sendMessage(req.params.orderId, 'owner', `Price proposal rejected.${notes ? ' Reason: ' + notes : ''}`, { senderId: 'system', factoryId });

      try {
        const { getIO } = require('../socket');
        const io = getIO();
        if (io) {
          io.to(`order_${req.params.orderId}`).emit('order_updated', { order: await getOrderById(req.params.orderId, factoryId) });
        }
      } catch (e) { /* non-critical */ }

      return success(res, { action, message_id: proposal.id });
    }
  } catch (err) {
    return next(err);
  }
});

router.post('/suggest-deadline', async (req, res, next) => {
  try {
    const result = await suggestDeadline(req.body, req.factoryId);
    return success(res, result);
  } catch (err) {
    return next(err);
  }
});

router.put('/:id/accept-deadline', async (req, res, next) => {
  try {
    const orderRes = await require('../db').query(
      'SELECT suggested_deadline FROM orders WHERE id = $1 AND factory_id = $2',
      [req.params.id, req.factoryId]
    );
    if (orderRes.rowCount === 0) return res.status(404).json({ success: false, error: 'Order not found' });
    if (!orderRes.rows[0].suggested_deadline) return res.status(400).json({ success: false, error: 'No suggested deadline to accept' });

    const updated = await require('../db').query(
      'UPDATE orders SET delivery_deadline = suggested_deadline, updated_at = NOW() WHERE id = $1 AND factory_id = $2 RETURNING *',
      [req.params.id, req.factoryId]
    );
    return success(res, updated.rows[0]);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;