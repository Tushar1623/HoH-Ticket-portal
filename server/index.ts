import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db';
import { initializeDatabase } from './services/initService';
import apiRoutes from './routes/api';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Staff-Passkey', 'X-Request-ID']
}));

app.use(express.json());

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'hoh-ticket-backend' });
});

// API Routes
app.use('/api', apiRoutes);

// Server startup
export const startServer = async () => {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await connectDB();
    console.log('🔄 Initializing database state...');
    await initializeDatabase();

    const server = app.listen(PORT, () => {
      console.log(`🚀 HOH Ticket Portal Backend running at http://localhost:${PORT}`);
    });

    return { app, server };
  } catch (err: any) {
    console.error('❌ Failed to start server:', err.message);
    // Still start Express server so local mocks / UI proxy don't crash
    const server = app.listen(PORT, () => {
      console.log(`⚠️ HOH Ticket Portal Backend running in fallback mode at http://localhost:${PORT}`);
    });
    return { app, server };
  }
};

// Auto-run if executed directly
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default app;
