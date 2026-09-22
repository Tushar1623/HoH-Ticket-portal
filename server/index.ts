import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { env } from './config/env';
import { connectDB } from './config/db';
import { initializeDatabase } from './services/initService';
import apiRoutes from './routes/api';

const app = express();

// Allowed Origins for CORS
const allowedOrigins = [
  env.FRONTEND_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    return callback(new Error('Blocked by CORS policy'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Idempotency-Key']
}));

app.use(express.json());

// Health Check
app.get('/health', (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  if (isConnected) {
    res.status(200).json({
      status: 'ok',
      database: 'atlas_connected',
      mode: 'mongodb_atlas',
      host: mongoose.connection.host || null,
      dbName: mongoose.connection.name || null,
      timestamp: new Date().toISOString(),
      service: 'hoh-ticket-backend'
    });
  } else {
    res.status(503).json({
      status: 'error',
      database: 'unavailable',
      mode: 'database_unavailable',
      timestamp: new Date().toISOString(),
      service: 'hoh-ticket-backend'
    });
  }
});

// API Routes
app.use('/api', apiRoutes);

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled server error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected error occurred.'
    }
  });
});

export const startServer = async () => {
  const server = app.listen(env.PORT, () => {
    console.log(`🚀 HOH Ticket Portal Backend running on port ${env.PORT}`);
    console.log(`📡 MongoDB Target: ${env.MONGODB_URI.split('@')[1] || 'Atlas Cluster'}`);
  });

  const attemptConnect = async () => {
    try {
      console.log('🔄 Attempting MongoDB Atlas connection...');
      await connectDB(env.MONGODB_URI);
      console.log('🌱 Checking idempotent database initialization...');
      await initializeDatabase();
      console.log('✅ MongoDB Atlas connected and initialized successfully!');
      return true;
    } catch (err: any) {
      console.warn('⚠️ MongoDB Atlas connection error:', err.message);
      return false;
    }
  };

  attemptConnect().then(success => {
    if (!success) {
      const retryTimer = setInterval(async () => {
        if (mongoose.connection.readyState === 1) {
          clearInterval(retryTimer);
          return;
        }
        const ok = await attemptConnect();
        if (ok) {
          clearInterval(retryTimer);
        }
      }, 15000);
    }
  });

  return { app, server };
};

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default app;
