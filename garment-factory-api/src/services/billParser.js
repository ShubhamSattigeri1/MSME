const pool = require('../db');
const { sendEmail } = require('./gmailSender');

// Lazy-load pdfjs-dist (heavy dependency)
let pdfjs = null;
async function getPdfjs() {
  if (!pdfjs) {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf');
    pdfjsLib.GlobalWorkerOptions.workerSrc = require('pdfjs-dist/legacy/build/pdf.worker.entry');
    pdfjs = pdfjsLib;
  }
  return pdfjs;
}

// Lazy-load Groq
let groq = null;
function getGroq() {
  if (!groq) {
    const Groq = require('groq-sdk');
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groq;
}

/**
 * Extract text from a PDF buffer using pdfjs-dist.
 */
async function extractTextFromPdf(pdfBuffer) {
  const pdfjsLib = await getPdfjs();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  let text = '';

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items) {
      text += item.str + ' ';
    }
    text += '\n---PAGE BREAK---\n';
  }

  return text.trim();
}

const BILL_EXTRACT_PROMPT = `You are a supplier bill/invoice extraction assistant.
Extract ALL line items from the following invoice text.

Return ONLY a valid JSON array. No preamble, no markdown fences.

Each item: { "material": "material name", "quantity": number, "unit": "unit", "rate": number, "amount": number }

Include every line item even if quantity is 0.
Match material names as closely as possible (e.g. "Black Cotton Fabric" → "Black Cotton").
Ignore headers, footers, totals, taxes, discounts. Only return actual product/material lines.`;

/**
 * Parse extracted text using Groq LLM.
 */
async function parseBillText(text) {
  const client = getGroq();
  const response = await client.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: BILL_EXTRACT_PROMPT },
      { role: 'user', content: text },
    ],
    temperature: 0.1,
    max_tokens: 2000,
  });

  const content = response.choices[0].message.content.trim();
  // Remove markdown fences if present
  const cleaned = content.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Fuzzy match a material name to the materials table.
 */
async function fuzzyMatchMaterial(materialName, factoryId) {
  const result = await pool.query(
    `SELECT id, name FROM materials WHERE factory_id = $1 ORDER BY name`,
    [factoryId]
  );

  const name = materialName.toLowerCase().trim();
  let bestMatch = null;
  let bestScore = 0;

  for (const mat of result.rows) {
    const matName = mat.name.toLowerCase();
    // Exact match
    if (matName === name) return mat;

    // Contains match
    if (matName.includes(name) || name.includes(matName)) {
      const score = Math.min(matName.length, name.length) / Math.max(matName.length, name.length);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = mat;
      }
    }
  }

  // Accept if score > 0.5
  return bestScore > 0.5 ? bestMatch : null;
}

/**
 * Main entry: process a PDF bill buffer.
 * Returns { items, materials_updated, alerts_created, text }
 */
async function processBill(pdfBuffer, factoryId) {
  const text = await extractTextFromPdf(pdfBuffer);
  const items = await parseBillText(text);
  const materialsUpdated = [];
  const alertsCreated = [];

  for (const item of items) {
    const mat = await fuzzyMatchMaterial(item.material, factoryId);
    if (!mat) {
      console.warn(`[BILL PARSER] No match for material: "${item.material}"`);
      alertsCreated.push(`Unmatched material: ${item.material} (qty: ${item.quantity})`);
      continue;
    }

    if (item.quantity <= 0) continue;

    // Update inventory
    await pool.query(
      `UPDATE materials SET qty_available = qty_available + $1, updated_at = datetime('now') WHERE id = $2 AND factory_id = $3`,
      [item.quantity, mat.id, factoryId]
    );

    // Record movement
    await pool.query(
      `INSERT INTO material_movement_log (order_id, material_id, material_name, qty_deducted, previous_stock, new_stock)
       VALUES ('bill_receipt', $1, $2, $3,
               (SELECT qty_available - $3 FROM materials WHERE id = $1),
               (SELECT qty_available FROM materials WHERE id = $1))`,
      [mat.id, mat.name, item.quantity]
    );

    materialsUpdated.push({
      material_id: mat.id,
      material_name: mat.name,
      added: item.quantity,
    });
  }

  // Send owner notification
  if (materialsUpdated.length > 0) {
    const factoryInfo = await pool.query(
      `SELECT name FROM factories WHERE id = $1`,
      [factoryId]
    );
    const factoryName = factoryInfo.rowCount > 0 ? factoryInfo.rows[0].name : 'Factory';

    const bodyParts = materialsUpdated.map(
      m => `  - ${m.material_name}: +${m.added}`
    );
    const emailBody = [
      `📦 Inventory Updated from Bill Receipt - ${factoryName}`,
      '',
      ...bodyParts,
      '',
      'Please review in the dashboard.',
    ].join('\n');

    // Create stock alert
    await pool.query(
      `INSERT INTO stock_alerts (factory_id, material_id, alert_type, message)
       VALUES ($1, NULL, 'bill_processed', $2)`,
      [factoryId, emailBody]
    );

    // Try sending email if Gmail is connected
    try {
      const ownerResult = await pool.query(
        `SELECT email FROM factory_owners WHERE factory_id = $1 LIMIT 1`,
        [factoryId]
      );
      if (ownerResult.rowCount > 0) {
        await sendEmail({
          factoryId,
          to: ownerResult.rows[0].email,
          subject: `📦 Inventory Updated from Bill Receipt`,
          body: emailBody,
        });
      }
    } catch (emailErr) {
      console.warn('[BILL PARSER] Failed to send notification email:', emailErr.message);
    }

    alertsCreated.push(`Inventory updated for ${materialsUpdated.length} material(s)`);
  }

  return { items, materials_updated: materialsUpdated, alerts_created: alertsCreated, text };
}

module.exports = { processBill, extractTextFromPdf, parseBillText };
