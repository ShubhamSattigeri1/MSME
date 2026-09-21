require('dotenv').config({ override: true });
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
- MULTI-ITEM: If buyer mentions multiple garment types separated by "and", "also", "plus", comma, or numbered list → create separate item objects for each.
- Each item must have its own quantity, fabric_type, colour, size_breakdown.
- If a field applies to all items (e.g. "all in cotton"), apply it to each item.
- Example: "Need 200 blue cotton shirts (M:100 L:100) and 300 black polyester trousers (32:150 34:150)" → items.length === 2.
- If the email is a reply or contains quoted/replied text from a previous email, scan the entire body (including quoted text) for an order reference like "Order Ref: MSME-xxxx" or "Ref: MSME-xxxx". Extract the full reference string (e.g. "MSME-a3b2c1d4").
- Ignore any image references, file attachments, or embedded media (e.g. [image: ...], cid:..., <img...>). Focus only on the written text content.

Respond ONLY with valid JSON. No preamble, no explanation, no markdown fences.

OUTPUT FORMAT:
{
  "is_order": true,
  "order_reference": "string or null",
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

async function parseOrderMessage(rawMessage) {
  const today = new Date().toISOString().split('T')[0];
  const systemPrompt = SYSTEM_PROMPT.replace('{{TODAY}}', today);

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: rawMessage }
      ],
      temperature: 0.1,
      max_tokens: 1000,
    });

    const text = response.choices[0].message.content.trim();

    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch (e) {
      console.error('[INTAKE] Failed to parse JSON from LLM:', text);
      return { is_order: false, error: 'api_error' };
    }

    if (!parsed.is_order) {
      console.log('[INTAKE] Not an order message');
      // Preserve extracted fields (delivery_deadline, items, order_reference, etc.)
      // for the merge path in intakeProcessor — the caller still checks is_order
      return parsed;
    }

    if (parsed.missing_fields && parsed.missing_fields.length > 0) {
      parsed.needs_followup = true;
      parsed.followup_questions = parsed.missing_fields
        .map(f => FOLLOWUP_QUESTIONS[f])
        .filter(Boolean);
    }

    console.log(`[INTAKE] ${parsed.buyer_name || 'unknown'} | confidence: ${parsed.confidence} | missing: ${parsed.missing_fields?.join(', ') || 'none'}`);

    return parsed;

  } catch (e) {
    console.error('[INTAKE] Groq API error:', e.message);
    return { is_order: false, error: 'api_error' };
  }
}

module.exports = { parseOrderMessage, FOLLOWUP_QUESTIONS };