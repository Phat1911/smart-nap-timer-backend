import express from 'express';
import cors from 'cors';
import { config } from './config';
import paymentsRouter from './routes/payments';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check (Render checks this on deploy)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'smart-nap-timer-backend' });
});

// Routes
app.use('/payments', paymentsRouter);

// Start
app.listen(config.port, () => {
  console.log(`Smart Nap Timer backend running on port ${config.port}`);
});
