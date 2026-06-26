const pool = require('../db');
const { isSunday, addWorkingDays, STITCHING_MINUTES, MINUTES_PER_PIECE, DAILY_CAPACITY_MINUTES } = require('./productionScheduler');

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

async function suggestDeadline(orderData, factoryId) {
  try {
    const items = orderData.items || [];
    if (!items.length) {
      throw new Error('No items provided');
    }

    const factors = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // STEP 1 — Calculate production time
    let totalMinutes = 0;
    let dataSourceType = 'formula';
    let confidenceReason = '';
    let totalHistoricalSamples = 0;
    const itemDetails = [];

    for (const item of items) {
      const qty = Number(item.quantity);
      const garmentType = (item.garment_type || '').toLowerCase();
      const stitchingMin = STITCHING_MINUTES[garmentType] || STITCHING_MINUTES.default;

      const perPiece = MINUTES_PER_PIECE.cutting + stitchingMin +
        MINUTES_PER_PIECE.finishing + MINUTES_PER_PIECE.quality_check + MINUTES_PER_PIECE.packing;
      const itemMinutes = perPiece * qty;
      totalMinutes += itemMinutes;

      let avgDaysPerUnit = null;
      let sampleSize = 0;
      try {
        const histRes = await pool.query(
          factoryId
            ? `SELECT AVG(pp.actual_days::float / NULLIF(pp.quantity, 0)) as avg_days_per_unit,
                    COUNT(*) as sample_size
               FROM production_performance pp
               JOIN orders o ON o.id = pp.order_id
               WHERE pp.garment_type = $1 AND pp.actual_days IS NOT NULL AND o.factory_id = $2`
            : `SELECT AVG(actual_days::float / NULLIF(quantity, 0)) as avg_days_per_unit,
                    COUNT(*) as sample_size
               FROM production_performance
               WHERE garment_type = $1 AND actual_days IS NOT NULL`,
          factoryId ? [garmentType, factoryId] : [garmentType]
        );
        if (histRes.rows[0] && histRes.rows[0].sample_size > 0) {
          sampleSize = Number(histRes.rows[0].sample_size);
          avgDaysPerUnit = histRes.rows[0].avg_days_per_unit
            ? Number(histRes.rows[0].avg_days_per_unit)
            : null;
        }
      } catch {
        // skip historical data on error
      }

      if (avgDaysPerUnit !== null && sampleSize >= 3) {
        totalHistoricalSamples += sampleSize;
        const formulaDays = perPiece / DAILY_CAPACITY_MINUTES;
        const weightedDays = (0.7 * avgDaysPerUnit * qty) + (0.3 * formulaDays * qty);
        itemDetails.push({ garmentType, days: weightedDays, source: 'mixed' });
        if (!dataSourceType || dataSourceType === 'formula') dataSourceType = 'mixed';
      } else {
        const formulaDays = itemMinutes / DAILY_CAPACITY_MINUTES;
        itemDetails.push({ garmentType, days: formulaDays, source: 'formula' });
      }
    }

    const totalDaysFromItems = itemDetails.reduce((sum, d) => sum + d.days, 0);
    const baseDays = Math.ceil(totalDaysFromItems);

    if (totalHistoricalSamples >= 5) {
      dataSourceType = 'historical';
      confidenceReason = `Based on ${totalHistoricalSamples} completed orders of this type`;
    } else if (totalHistoricalSamples >= 3) {
      dataSourceType = 'mixed';
      confidenceReason = `Based on ${totalHistoricalSamples} completed orders and formula estimate`;
    } else {
      confidenceReason = 'Formula estimate — no historical data';
    }

    factors.push(`Production: ${baseDays} days`);

    // STEP 2 — Queue load
    let queueDays = 0;
    try {
      const queueRes = await pool.query(
        factoryId
          ? `SELECT COALESCE(SUM(ps.total_minutes), 0) as queue_minutes
               FROM production_schedule ps
               JOIN orders o ON o.id = ps.order_id
               WHERE ps.current_stage != 'done' AND o.factory_id = $1`
          : `SELECT COALESCE(SUM(total_minutes), 0) as queue_minutes
               FROM production_schedule
               WHERE current_stage != 'done'`,
        factoryId ? [factoryId] : []
      );
      const queueMinutes = Number(queueRes.rows[0]?.queue_minutes || 0);
      queueDays = Math.ceil(queueMinutes / DAILY_CAPACITY_MINUTES);
      factors.push(`Current queue: ${queueDays} days`);
    } catch {
      factors.push('Queue load: unavailable');
    }

    // STEP 3 — Material lead time
    let materialDelayDays = 0;
    let shortageMaterial = '';
      try {
        const requirements = new Map();
        for (const item of items) {
          const qty = Number(item.quantity);
          const bomRes = await pool.query(
            factoryId
              ? `SELECT b.material_id, b.qty_per_unit, m.qty_available, m.name, m.supplier_lead_days
                   FROM bom b JOIN materials m ON m.id = b.material_id
                   WHERE b.garment_type = $1 AND b.factory_id = $2`
              : `SELECT b.material_id, b.qty_per_unit, m.qty_available, m.name, m.supplier_lead_days
                   FROM bom b JOIN materials m ON m.id = b.material_id
                   WHERE b.garment_type = $1`,
            factoryId ? [item.garment_type, factoryId] : [item.garment_type]
          );
        for (const row of bomRes.rows) {
          const req = Number(row.qty_per_unit) * qty;
          const existing = requirements.get(row.material_id) || {
            required: 0,
            available: Number(row.qty_available),
            name: row.name,
            leadDays: Number(row.supplier_lead_days || 7),
          };
          existing.required += req;
          requirements.set(row.material_id, existing);
        }
      }

      let maxLeadDays = 0;
      for (const [, req] of requirements) {
        if (req.required > req.available && req.leadDays > maxLeadDays) {
          maxLeadDays = req.leadDays;
          shortageMaterial = req.name;
        }
      }
      materialDelayDays = maxLeadDays;
      if (materialDelayDays > 0) {
        factors.push(`Material delay: ${materialDelayDays} days for ${shortageMaterial}`);
      }
    } catch {
      factors.push('Material check: unavailable');
    }

    // STEP 4 — Buffer
    let bufferDays = Math.ceil(baseDays * 0.15);
    bufferDays = Math.max(2, Math.min(7, bufferDays));
    factors.push(`Buffer: ${bufferDays} days`);

    // STEP 5 — Calculate suggested date
    const totalDays = baseDays + queueDays + materialDelayDays + bufferDays;
    const suggestedDate = addWorkingDays(new Date(today), totalDays);

    // STEP 6 — Confidence
    let confidence = 'low';
    if (totalHistoricalSamples >= 5 && materialDelayDays === 0) {
      confidence = 'high';
    } else if (totalHistoricalSamples >= 3 || materialDelayDays === 0) {
      if (totalHistoricalSamples >= 3) confidence = 'medium';
      else if (materialDelayDays === 0) confidence = 'medium';
    }

    if (totalHistoricalSamples === 0 && materialDelayDays > 0) {
      confidence = 'low';
      confidenceReason = 'Formula estimate — no historical data';
    }

    if (materialDelayDays > 0 && totalHistoricalSamples >= 3) {
      confidence = 'medium';
    }

    return {
      suggested_deadline: formatDate(suggestedDate),
      total_days_required: totalDays,
      breakdown: {
        production_days: baseDays,
        queue_delay_days: queueDays,
        material_delay_days: materialDelayDays,
        buffer_days: bufferDays,
        data_source: dataSourceType,
      },
      confidence,
      confidence_reason: confidenceReason,
      factors_considered: factors,
    };
  } catch (err) {
    return {
      suggested_deadline: null,
      total_days_required: 0,
      breakdown: {
        production_days: 0,
        queue_delay_days: 0,
        material_delay_days: 0,
        buffer_days: 0,
        data_source: 'formula',
      },
      confidence: 'low',
      confidence_reason: `Calculation error: ${err.message}`,
      factors_considered: ['Error calculating deadline'],
      error: err.message,
    };
  }
}

module.exports = { suggestDeadline };
