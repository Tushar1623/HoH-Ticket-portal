import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// mongoose.set('bufferCommands', false);

export const connectDB = async (customUri?: string): Promise<typeof mongoose> => {
  let uri = customUri || process.env.MONGO_URL || process.env.MONGODB_URI;

  if (!uri || uri.includes('<db_password>')) {
    console.warn('⚠️ No active MongoDB Atlas password found in MONGO_URL. Falling back to local MongoDB.');
    uri = process.env.LOCAL_MONGODB_URI || 'mongodb://127.0.0.1:27017/hoh_tickets_db';
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

