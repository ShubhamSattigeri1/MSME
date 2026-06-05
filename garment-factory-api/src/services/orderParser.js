const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const SYSTEM_PROMPT = `You are an order extraction assistant for a garment manufacturing factory.
Your job is to read a raw buyer message (email or WhatsApp) and extract structured order information.

RULES:
- Extract ONLY what is explicitly stated. Do not infer or assume.
- If a field is not mentioned, set it to null.
- delivery_deadline must be YYYY-MM-DD. Relative terms calculated from today: {{TODAY}}.
- quantity is a number only (strip pcs, pieces, units).
- Multiple garment types → separate objects in items array.
- garment_type: short lowercase e.g. "formal shirt", "kurta", "t-shirt".
- If not an order at all (greeting, complaint, payment follow-up), set is_order: false.

Respond ONLY with valid JSON. No preamble, no explanation, no markdown fences.

OUTPUT FORMAT:
{
  "is_order": true,
  "buyer_name": "string or null",
  "buyer_contact": "string or null",
  "delivery_deadline": "YYYY-MM-DD or null",
  "special_instructions": "string or null",
  "items": [{
    "garment_type": "string",
    "fabric_type": "string or null",
    "colour": "string or null",
    "quantity": number,
    "size_breakdown": { "S": number, "M": number } or null,
    "special_notes": "string or null"
  }],
  "missing_fields": ["list of field names that are null but required"],
  "confidence": "high | medium | low"
}

REQUIRED fields — flag in missing_fields if null:
delivery_deadline, fabric_type (per item), colour (per item), size_breakdown (per item)

CONFIDENCE:
- high: all required fields present, message is clear
- medium: 1-2 required fields missing or slightly ambiguous
- low: major fields missing or message is very vague`;

const FOLLOWUP_QUESTIONS = {
  delivery_deadline: 'When do you need this order delivered by?',
  fabric_type: 'What fabric type do you need? (e.g. cotton, polyester, linen)',
  colour: 'What colour(s) do you need?',
  size_breakdown: 'Could you share the size-wise quantity split? (e.g. S:100, M:200, L:150)',
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function buildFollowupQuestions(missingFields) {
  const questions = [];
  const seen = new Set();

  for (const rawField of missingFields) {
    const field = String(rawField);
    const key = Object.keys(FOLLOWUP_QUESTIONS).find((candidate) => field.includes(candidate));

    if (key && !seen.has(key)) {
      seen.add(key);
      questions.push(FOLLOWUP_QUESTIONS[key]);
    }
  }

  return questions;
}

function logParsedResult(parsed) {
  const buyerName = parsed.buyer_name || 'unknown';
  const confidence = parsed.confidence || 'unknown';
  const missingFields = Array.isArray(parsed.missing_fields) && parsed.missing_fields.length > 0
    ? parsed.missing_fields.join(',')
    : 'none';

  console.log(`[INTAKE] ${buyerName} | confidence: ${confidence} | missing: ${missingFields}`);
}

async function parseOrderMessage(rawMessage) {
  const today = new Date().toISOString().split('T')[0];
  const systemPrompt = SYSTEM_PROMPT.replace('{{TODAY}}', today);

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: systemPrompt,
    });

    const result = await model.generateContent(rawMessage);
    const text = result.response.text().trim();

    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch (e) {
      throw new Error('Gemini returned invalid JSON: ' + text);
    }

    if (!parsed.is_order) {
      logParsedResult(parsed);
      return { is_order: false };
    }

    const missingFields = Array.isArray(parsed.missing_fields) ? parsed.missing_fields : [];
    const enriched = {
      ...parsed,
      missing_fields: missingFields,
    };

    if (missingFields.length > 0) {
      enriched.needs_followup = true;
      enriched.followup_questions = buildFollowupQuestions(missingFields);
    }

    logParsedResult(enriched);
    return enriched;
  } catch (err) {
    console.error('[INTAKE] unknown | confidence: unknown | missing: api_error', err.message);
    return { is_order: false, error: 'api_error' };
  }
}

module.exports = {
  parseOrderMessage,
  SYSTEM_PROMPT,
};
