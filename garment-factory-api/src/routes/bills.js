const express = require('express');
const multer = require('multer');
const pool = require('../db');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function success(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

// POST /api/bills/upload — upload and parse a PDF bill
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const filename = req.file.originalname;

    // Insert record with pending status
    const billResult = await pool.query(
      `INSERT INTO bill_uploads (factory_id, filename, status)
       VALUES ($1, $2, 'pending') RETURNING *`,
      [req.factoryId, filename]
    );
    const billId = billResult.rows[0].id;

    // Parse PDF (defer to billParser)
    try {
      const { processBill } = require('../services/billParser');
      const result = await processBill(req.file.buffer, req.factoryId);

      await pool.query(
        `UPDATE bill_uploads SET status = 'processed', raw_text = $1, parsed_json = $2, processed_at = datetime('now')
         WHERE id = $3`,
        [result.text || '', JSON.stringify(result.items || []), billId]
      );

      return success(res, {
        id: billId,
        items: result.items,
        materials_updated: result.materials_updated,
        alerts_created: result.alerts_created,
      });
    } catch (parseErr) {
      await pool.query(
        `UPDATE bill_uploads SET status = 'error', error_message = $1, processed_at = datetime('now') WHERE id = $2`,
        [parseErr.message, billId]
      );
      return res.status(422).json({ success: false, error: parseErr.message, bill_id: billId });
    }
  } catch (err) {
    return next(err);
  }
});

// GET /api/bills — list uploaded bills
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT * FROM bill_uploads WHERE factory_id = $1 ORDER BY uploaded_at DESC LIMIT 50`,
      [req.factoryId]
    );
    return success(res, result.rows);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
