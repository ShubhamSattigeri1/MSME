const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('[NOTIFY] SMTP credentials not configured — emails will be skipped');
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port: Number(port) || 587,
    secure: Number(port) === 465,
    auth: { user, pass },
  });

  return transporter;
}

function isPhoneNumber(contact) {
  if (!contact) return true;
  return !contact.includes('@');
}

function pad(n) { return String(n).padStart(2, '0'); }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateDisplay(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return dateStr;
  }
}

async function sendMail(to, subject, text) {
  const transport = getTransporter();
  if (!transport) {
    console.log(`[NOTIFY] Skipping email — no SMTP configured. To: ${to}, Subject: ${subject}`);
    return;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const factoryName = process.env.FACTORY_NAME || 'Garment Factory';

  try {
    await transport.sendMail({
      from: `"${factoryName}" <${from}>`,
      to,
      subject,
      text,
    });
    console.log(`[NOTIFY] Email sent to ${to}: ${subject}`);
  } catch (err) {
    console.error(`[NOTIFY] Failed to send email to ${to}:`, err.message);
  }
}

async function sendOrderReceived(order) {
  const contact = order.buyer_contact;
  if (isPhoneNumber(contact)) {
    console.log(`[NOTIFY] Skipping email — contact is phone: ${contact}`);
    return;
  }

  const factoryName = process.env.FACTORY_NAME || 'Garment Factory';
  const itemsSummary = (order.items || []).map(i => `${i.quantity}x ${i.garment_type}`).join(', ');
  const totalQty = (order.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);

  const text = `Dear ${order.buyer_name || 'Customer'},

Thank you for your order with ${factoryName}.

We have received your order with ${totalQty} pieces (${itemsSummary}).

Our team will review the order and get back to you with a quotation shortly.

If you have any questions, please don't hesitate to reach out.

 Regards,
${factoryName}`;

  await sendMail(contact, `Order received — ${factoryName}`, text);
}

async function sendQuotationReady(order, quotation) {
  const contact = order.buyer_contact;
  if (isPhoneNumber(contact)) {
    console.log(`[NOTIFY] Skipping email — contact is phone: ${contact}`);
    return;
  }

  const qData = quotation.data || quotation;
  const itemsLines = (qData.items || []).map(
    (i) => `  ${i.garment_type} (${i.fabric_type || '-'}): ${i.quantity} pcs @ ₹${i.unit_price} = ₹${i.item_total}`
  ).join('\n');

  const text = `Dear ${order.buyer_name || 'Customer'},

Please find your quotation below:

Quotation #: ${qData.quotation_number}
Date: ${formatDateDisplay(qData.generated_at)}
Valid Until: ${formatDateDisplay(qData.valid_until)}

Items:
${itemsLines}

Subtotal: ₹${qData.subtotal}
GST (18%): ₹${qData.tax_amount}
Grand Total: ₹${qData.grand_total}

Payment Terms: ${qData.payment_terms || '50% advance, 50% on delivery'}

Note: ${qData.notes || 'Prices valid for 7 days. Subject to material availability.'}

--- CONFIRM YOUR ORDER ---

To confirm this order, discuss pricing, or request changes, please log in to your buyer portal:
${process.env.BUYER_PORTAL_URL || 'http://localhost:3002'}

You can accept or negotiate the price directly through the chat on your order page.

Regards,
${process.env.FACTORY_NAME || 'Garment Factory'}`;

  await sendMail(contact, `Quotation ${qData.quotation_number} — Please confirm your order`, text);
}

async function sendProductionStarted(order, schedule) {
  const contact = order.buyer_contact;
  if (isPhoneNumber(contact)) {
    console.log(`[NOTIFY] Skipping email — contact is phone: ${contact}`);
    return;
  }

  const factoryName = process.env.FACTORY_NAME || 'Garment Factory';
  const completionDate = formatDateDisplay(schedule.expected_completion);

  const text = `Dear ${order.buyer_name || 'Customer'},

Great news! Production for your order has started.

Expected completion date: ${completionDate}
Total pieces: ${(order.items || []).reduce((s, i) => s + Number(i.quantity || 0), 0)}

We will keep you updated on the progress. If you have any questions, feel free to reach out.

Regards,
${factoryName}`;

  await sendMail(contact, 'Production started for your order', text);
}

async function sendOrderShipped(order) {
  const contact = order.buyer_contact;
  if (isPhoneNumber(contact)) {
    console.log(`[NOTIFY] Skipping email — contact is phone: ${contact}`);
    return;
  }

  const factoryName = process.env.FACTORY_NAME || 'Garment Factory';

  const text = `Dear ${order.buyer_name || 'Customer'},

Your order has been dispatched!

Order details:
- Total pieces: ${(order.items || []).reduce((s, i) => s + Number(i.quantity || 0), 0)}
- Items: ${(order.items || []).map(i => `${i.quantity}x ${i.garment_type}`).join(', ')}

Thank you for choosing ${factoryName}. We look forward to working with you again.

Regards,
${factoryName}`;

  await sendMail(contact, 'Your order has been dispatched', text);
}

async function sendDeadlineAtRisk(order, schedule) {
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail || isPhoneNumber(ownerEmail)) {
    console.log(`[NOTIFY] Skipping deadline-at-risk email — no OWNER_EMAIL configured`);
    return;
  }

  const factoryName = process.env.FACTORY_NAME || 'Garment Factory';

  const text = `⚠ Deadline at Risk Alert

Order: ${order.id}
Buyer: ${order.buyer_name || 'Unknown'}
Delivery Deadline: ${formatDateDisplay(order.delivery_deadline)}
Expected Completion: ${formatDateDisplay(schedule.expected_completion)}

This order's production schedule indicates it may not meet the delivery deadline.

Please review and take appropriate action.

— ${factoryName} Production System`;

  await sendMail(ownerEmail, `⚠ Deadline at risk: ${order.buyer_name || 'Unknown'}`, text);
}

async function sendNewPortalOrder(order, buyer) {
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail || isPhoneNumber(ownerEmail)) {
    console.log(`[NOTIFY] Skipping portal order notification — no OWNER_EMAIL configured`);
    return;
  }

  const factoryName = process.env.FACTORY_NAME || 'Garment Factory';
  const dashboardUrl = process.env.OWNER_DASHBOARD_URL || 'http://localhost:3000';
  const items = order.items || [];
  const itemsLines = items.map(
    (i) => `  - ${i.garment_type} (${i.fabric_type || '-'}, ${i.colour || '-'}): ${i.quantity} pcs`
  ).join('\n');
  const totalQty = items.reduce((s, i) => s + Number(i.quantity || 0), 0);

  const text = `New order from buyer portal

Buyer: ${buyer.name} (${buyer.email || buyer.phone || 'N/A'})
Items:
${itemsLines}
Total quantity: ${totalQty} pieces
Requested deadline: ${formatDateDisplay(order.delivery_deadline)}
Suggested deadline: ${formatDateDisplay(order.suggested_deadline)}
Total price: ₹${order.total_price ? Number(order.total_price).toLocaleString('en-IN') : 'Calculating...'}
View order: ${dashboardUrl}/orders/${order.id}

— ${factoryName} Buyer Portal`;

  await sendMail(ownerEmail, `New order from buyer portal — ${buyer.name}`, text);
}

module.exports = {
  sendOrderReceived,
  sendQuotationReady,
  sendProductionStarted,
  sendOrderShipped,
  sendDeadlineAtRisk,
  sendNewPortalOrder,
};
