import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// mongoose.set('bufferCommands', false);

export const connectDB = async (customUri?: string): Promise<typeof mongoose> => {
  // Primary variable: MONGODB_URI. MONGO_URL is a legacy alias — accepted but not preferred.
  // LOCAL_MONGODB_URI is NOT used in production. Do not fall back to localhost.
  const uri = customUri || process.env.MONGODB_URI || process.env.MONGO_URL;

  if (!uri) {
    throw new Error('FATAL: MONGODB_URI environment variable is required to connect to the database.');
  }

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    console.log(`✅ MongoDB Connected successfully: ${conn.connection.host} / ${conn.connection.name}`);
    return conn;
  } catch (err: any) {
    throw err;
  }
};

export const disconnectDB = async (): Promise<void> => {
  await mongoose.disconnect();
};

