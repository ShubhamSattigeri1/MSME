require('dotenv').config();
const express = require('express');
const cors = require('cors');
const errorHandler = require('./middleware/errorHandler');

const ordersRouter = require('./routes/orders');
const materialsRouter = require('./routes/materials');
const bomRouter = require('./routes/bom');
const pricingRouter = require('./routes/pricing');
const purchaseOrdersRouter = require('./routes/purchaseOrders');
const intakeRouter = require('./routes/intake');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', async (req, res) => {
  try {
    const { pool } = require('./db');
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: 'error', db: 'error', timestamp: new Date().toISOString() });
  }
});

app.use('/api/orders', ordersRouter);
app.use('/api/materials', materialsRouter);
app.use('/api/bom', bomRouter);
app.use('/api/pricing', pricingRouter);
app.use('/api/purchase-orders', purchaseOrdersRouter);
app.use('/api/intake', intakeRouter);

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
