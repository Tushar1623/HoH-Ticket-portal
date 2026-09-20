import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URL;
if (!mongoUri) {
  console.error('❌ MONGODB_URI or MONGO_URL environment variable is required.');
  process.exit(1);
}

async function prepareProductionDatabase() {
  console.log('🔄 Connecting to MongoDB Atlas...');
  await mongoose.connect(mongoUri as string, {
    serverSelectionTimeoutMS: 20000,
    connectTimeoutMS: 20000
  });
  console.log(`✅ Connected to MongoDB Atlas: ${mongoose.connection.name}`);

  const db = mongoose.connection.db;
  if (!db) throw new Error('Database handle unavailable');

  // 1. Purge bookings and legacy collections
  console.log('🧹 Clearing old bookings and legacy collections...');
  await db.collection('bookings').deleteMany({});

  const existingCollections = (await db.listCollections().toArray()).map(c => c.name);
  for (const col of ['event_backups', 'idempotency_keys', 'audit_logs']) {
    if (existingCollections.includes(col)) {
      await db.collection(col).deleteMany({});
      console.log(`   Cleaned ${col}`);
    }
  }

  // 2. Initialize or reset atomic Counter
  console.log('🔢 Initializing atomic booking counter...');
  await db.collection('counters').updateOne(
    { _id: 'bookingCode' as any },
    { $set: { seq: 0 } },
    { upsert: true }
  );

  // 3. Ensure single Admin user
  console.log('👤 Ensuring single Admin account...');
  await db.collection('admins').deleteMany({});
  await db.collection('users').deleteMany({});

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@houseofhumour.com';
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass) {
    throw new Error('ADMIN_PASSWORD environment variable is required to initialize the admin account.');
  }
  const passwordHash = await bcrypt.hash(adminPass, 10);
  const now = new Date();

  await db.collection('admins').insertOne({
    username: 'admin',
    email: adminEmail.toLowerCase().trim(),
    name: 'System Admin',
    passwordHash,
    isActive: true,
    createdAt: now,
    updatedAt: now
  });
  console.log(`✅ Admin account created: username=admin, email=${adminEmail}`);

  // 4. Seed/reset exactly 50 clean tickets HOH001 to HOH050
  console.log('🎟️ Seeding exactly 50 clean AVAILABLE tickets (HOH001 to HOH050)...');
  await db.collection('tickets').deleteMany({});

  const tickets = [];
  for (let i = 1; i <= 50; i++) {
    const code = `HOH${String(i).padStart(3, '0')}`;
    tickets.push({
      code,
      serialNumber: i,
      status: 'available',
      bookingId: null,
      buyerName: null,
      phone: null,
      email: null,
      entered: false,
      enteredAt: null,
      qrPayload: code,
      createdAt: now,
      updatedAt: now
    });
  }

  await db.collection('tickets').insertMany(tickets);

  // 5. Create essential unique indexes
  console.log('⚡ Creating database indexes...');
  await db.collection('tickets').createIndex({ code: 1 }, { unique: true });
  await db.collection('tickets').createIndex({ serialNumber: 1 }, { unique: true });
  await db.collection('tickets').createIndex({ status: 1 });
  await db.collection('tickets').createIndex({ entered: 1 });
  await db.collection('tickets').createIndex({ bookingId: 1 });

  await db.collection('bookings').createIndex({ bookingCode: 1 }, { unique: true });
  await db.collection('bookings').createIndex({ phone: 1 });
  await db.collection('bookings').createIndex({ email: 1 });

  await db.collection('admins').createIndex({ username: 1 }, { unique: true });
  await db.collection('admins').createIndex({ email: 1 }, { unique: true });

  const totalTickets = await db.collection('tickets').countDocuments();
  const totalBookings = await db.collection('bookings').countDocuments();
  const totalAdmins = await db.collection('admins').countDocuments();

  console.log('\n=============================================');
  console.log('🏆 DATABASE PREPARATION COMPLETE:');
  console.log(`   Tickets:   ${totalTickets} (HOH001 to HOH050 - All Available)`);
  console.log(`   Bookings:  ${totalBookings}`);
  console.log(`   Admins:    ${totalAdmins}`);
  console.log('=============================================\n');

  await mongoose.disconnect();
}

prepareProductionDatabase().catch(err => {
  console.error('❌ Database preparation error:', err);
  process.exit(1);
});
