import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export interface EnvConfig {
  PORT: number;
  MONGODB_URI: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
  NODE_ENV: string;
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;
}

export const validateEnv = (): EnvConfig => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('FATAL CONFIGURATION ERROR: JWT_SECRET environment variable is required.');
  }

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!mongoUri) {
    throw new Error('FATAL CONFIGURATION ERROR: MONGODB_URI or MONGO_URL environment variable is required.');
  }

  const port = parseInt(process.env.PORT || '5000', 10);
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const nodeEnv = process.env.NODE_ENV || 'development';

  return {
    PORT: port,
    MONGODB_URI: mongoUri,
    JWT_SECRET: jwtSecret,
    FRONTEND_URL: frontendUrl,
    NODE_ENV: nodeEnv,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'admin@houseofhumour.com',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD
  };
};

export const env = validateEnv();
