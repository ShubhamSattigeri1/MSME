const TEMPLATES = {
  order_received: {
    key: 'order_received',
    label: 'Order Received',
    body: 'Dear {buyer_name}, we have received your order #{order_id_short} for {total_qty} pieces. We will send you a quotation shortly.',
  },
  quotation_sent: {
    key: 'quotation_sent',
    label: 'Quotation Sent',
    body: 'Dear {buyer_name}, please find your quotation #{quotation_number} attached. Total amount: {grand_total}. Valid until {valid_until}. Please confirm at your earliest convenience.',
  },
  awaiting_confirmation: {
    key: 'awaiting_confirmation',
    label: 'Awaiting Confirmation',
    body: 'Dear {buyer_name}, we are awaiting your confirmation for order #{order_id_short}. Please confirm by {confirm_by_date} so we can begin production on schedule.',
  },
  production_started: {
    key: 'production_started',
    label: 'Production Started',
    body: 'Dear {buyer_name}, production has started on your order. Expected completion: {expected_completion}.',
  },
  order_shipped: {
    key: 'order_shipped',
    label: 'Order Shipped',
    body: 'Dear {buyer_name}, your order of {total_qty} pieces has been dispatched. Thank you for your business.',
  },
  payment_reminder: {
    key: 'payment_reminder',
    label: 'Payment Reminder',
    body: 'Dear {buyer_name}, this is a reminder that payment for order #{order_id_short} of {grand_total} is due. Please arrange payment at your earliest convenience.',
  },
  custom: {
    key: 'custom',
    label: 'Custom Message',
    body: '',
  },
};

function resolveTemplate(templateKey, variables) {
  const template = TEMPLATES[templateKey];
  if (!template) return '';
  let resolved = template.body;
  for (const [key, value] of Object.entries(variables || {})) {
    resolved = resolved.replace(new RegExp(`\\{${key}\\}`, 'g'), value != null ? String(value) : `{${key}}`);
  }
  return resolved;
}

module.exports = { TEMPLATES, resolveTemplate };
