require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { setIO } = require('./socket');
const errorHandler = require('./middleware/errorHandler');
const ownerAuth = require('./middleware/ownerAuth');

const authRoutes = require('./routes/auth');
const ordersRouter = require('./routes/orders');
const materialsRouter = require('./routes/materials');
const bomRouter = require('./routes/bom');
const pricingRouter = require('./routes/pricing');
const purchaseOrdersRouter = require('./routes/purchaseOrders');
const intakeRouter = require('./routes/intake');
const gmailRouter = require('./routes/gmail');
const productionRouter = require('./routes/production');
const buyersRouter = require('./routes/buyers');
const messagesRouter = require('./routes/messages');
const confirmationRouter = require('./routes/confirmation');
const analyticsRouter = require('./routes/analytics');
const garmentPricingRouter = require('./routes/garmentPricing');
const factoriesRouter = require('./routes/factories');
const { startPolling } = require('./services/gmailPoller');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', async (req, res) => {
  try {
    const pool = require('./db');
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: 'error', db: 'error', message: e.message, timestamp: new Date().toISOString() });
  }
});

// Public routes (no auth)
app.use('/api/auth', authRoutes);
app.use('/api/confirm', confirmationRouter);
app.use('/api/intake', intakeRouter);
app.use('/api/gmail', gmailRouter);

// Owner-protected routes
app.use('/api/orders', ownerAuth, ordersRouter);
app.use('/api/materials', ownerAuth, materialsRouter);
app.use('/api/bom', ownerAuth, bomRouter);
app.use('/api/pricing', ownerAuth, pricingRouter);
app.use('/api/purchase-orders', ownerAuth, purchaseOrdersRouter);
app.use('/api/production', ownerAuth, productionRouter);
app.use('/api/buyers', ownerAuth, buyersRouter);
app.use('/api', ownerAuth, messagesRouter);
app.use('/api/analytics', ownerAuth, analyticsRouter);
app.use('/api/factories', ownerAuth, factoriesRouter);
app.use('/api/garment-pricing', ownerAuth, garmentPricingRouter);

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  socket.on('join_order', (orderId) => {
    if (orderId) {
      socket.join(`order_${orderId}`);
      console.log(`[WS] ${socket.id} joined order_${orderId}`);
    }
  });

  socket.on('leave_order', (orderId) => {
    if (orderId) {
      socket.leave(`order_${orderId}`);
      console.log(`[WS] ${socket.id} left order_${orderId}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

setIO(io);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (HTTP + WebSocket)`);
  startPolling();
});
