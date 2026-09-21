import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export interface EnvConfig {
  /** Listening port. In production this is injected by the deployment platform (Render). */
  PORT: number;
  /** Primary MongoDB Atlas connection string. Use MONGODB_URI in all environments. */
  MONGODB_URI: string;
  /** JWT signing secret. Required. Must be a long random string. */
  JWT_SECRET: string;
  /** Allowed CORS origin for the admin frontend. */
  FRONTEND_URL: string;
  /** deployment environment */
  NODE_ENV: string;
  /** Admin account email (used on first-run DB seeding). */
  ADMIN_EMAIL: string;
  /** Admin account password. Required. Used for first-run seeding and offline Atlas fallback login. */
  ADMIN_PASSWORD: string;
}

export const validateEnv = (): EnvConfig => {
  // --- Required secrets ---
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('FATAL: JWT_SECRET environment variable is required and not set.');
  }

  // MONGODB_URI is primary. MONGO_URL is a legacy alias — accepted but not preferred.
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!mongoUri) {
    throw new Error('FATAL: MONGODB_URI environment variable is required and not set.');
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('FATAL: ADMIN_PASSWORD environment variable is required and not set.');
  }

  // --- Optional with safe defaults ---
  // PORT: Do NOT hardcode in production. The deployment platform (Render) injects this.
  const port = parseInt(process.env.PORT || '5000', 10);
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const nodeEnv = process.env.NODE_ENV || 'development';
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@houseofhumour.com';

  return {
    PORT: port,
    MONGODB_URI: mongoUri,
    JWT_SECRET: jwtSecret,
    FRONTEND_URL: frontendUrl,
    NODE_ENV: nodeEnv,
    ADMIN_EMAIL: adminEmail,
    ADMIN_PASSWORD: adminPassword
  };
};

export const env = validateEnv();

