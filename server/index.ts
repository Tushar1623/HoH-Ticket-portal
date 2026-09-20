import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
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
  const isConnected = mongoose.connection.readyState === 1;
  res.json({
    status: isConnected ? 'ok' : 'degraded',
    database: isConnected ? 'connected' : 'disconnected',
    host: mongoose.connection.host || null,
    dbName: mongoose.connection.name || null,
    timestamp: new Date().toISOString(),
    service: 'hoh-ticket-backend',
    ipNotice: isConnected ? null : 'If MongoDB Atlas returns an IP whitelist error, add current IP or 0.0.0.0/0 in Atlas Network Access.'
  });
});

// API Routes
app.use('/api', apiRoutes);

// Server startup with immediate HTTP availability and background MongoDB connection
export const startServer = async () => {
  const server = app.listen(PORT, () => {
    console.log(`🚀 HOH Ticket Portal Backend running at http://localhost:${PORT}`);
  });

  const attemptConnect = async () => {
    try {
      console.log('🔄 Connecting to MongoDB...');
      await connectDB();
      console.log('🔄 Initializing database state...');
      await initializeDatabase();
      console.log('✅ MongoDB connected and initialized successfully!');
      return true;
    } catch (err: any) {
      console.error('❌ MongoDB connection deferred:', err.message);
      return false;
    }
  };

  attemptConnect().then(success => {
    if (!success) {
      console.warn('⚠️ Server active with in-memory fallback. Background retry every 10s...');
      const retryInterval = setInterval(async () => {
        if (mongoose.connection.readyState === 1) {
          clearInterval(retryInterval);
          return;
        }
        const ok = await attemptConnect();
        if (ok) {
          clearInterval(retryInterval);
        }
      }, 10000);
    }
  });

  return { app, server };
};

// Auto-run if executed directly
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default app;
