import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { connectDB, disconnectDB } from '../config/db';
import { Ticket } from '../models/Ticket';
import { Booking } from '../models/Booking';
import { AuditLog } from '../models/AuditLog';
import { User } from '../models/User';

dotenv.config();

async function runCleanup() {
  console.log('=====================================================');
  console.log('🧹 HOH TICKET PORTAL — MONGODB CLEANUP & COMPACTION');
  console.log('=====================================================');

  const rawUri = process.env.MONGODB_URI || '';
  if (rawUri.includes('<db_password>')) {
    console.log('\n⚠️  ATTENTION:');
    console.log('   MONGODB_URI in your .env contains the placeholder "<db_password>".');
    console.log('   Please replace "<db_password>" with your actual MongoDB Atlas password in .env:');
    console.log('   MONGODB_URI=mongodb+srv://astittvamedia_db_user:<your_password>@cluster0.ljtgvll.mongodb.net/?appName=Cluster0');
    console.log('   Then re-run: npm run db:clean\n');
  }

  try {
    const conn = await connectDB();
    const db = conn.connection.db;

    if (!db) {
      throw new Error('Database handle is not available.');
    }

    console.log(`\n📊 Analyzing current database: ${conn.connection.name}`);

    // 1. Initial Stats
    try {
      const initialStats = await db.stats();
      console.log(`   - Data Size: ${(initialStats.dataSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   - Storage Allocated: ${(initialStats.storageSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   - Total Objects: ${initialStats.objects}`);
      console.log(`   - Collections Count: ${initialStats.collections}`);
    } catch {
      console.log('   - (Stats command unavailable on this cluster tier)');
    }

    // 2. Discover Collections
    const collections = await db.listCollections().toArray();
    const names = collections.map(c => c.name);
    console.log(`\n📦 Collections found in database: [${names.join(', ')}]`);

    // 3. Drop bloated/orphaned collections
    const dropCandidates = [
      'backups',
      'audit_logs',
      'auditlogs',
      'tickets_old',
      'event_backups',
      'test',
      'temp_tickets'
    ];

    console.log('\n🗑️ Dropping orphaned and bloated legacy collections...');
    for (const name of dropCandidates) {
      if (names.includes(name)) {
        await db.dropCollection(name);
        console.log(`   ✅ Dropped collection: ${name}`);
      }
    }

    // 4. Purge existing Audit Logs to immediately reclaim disk space
    console.log('\n🧹 Purging accumulated audit log records...');
    const auditDeleteRes = await AuditLog.deleteMany({});
    console.log(`   ✅ Deleted ${auditDeleteRes.deletedCount} old audit log entries.`);

    // 5. Clean and rebuild Bookings
    console.log('\n🧹 Clearing old bookings...');
    const bookingDeleteRes = await Booking.deleteMany({});
    console.log(`   ✅ Deleted ${bookingDeleteRes.deletedCount} booking records.`);

    // 6. Clean and re-seed lean 50 tickets
    console.log('\n🌱 Seeding 50 ultra-compact lean tickets (HOH001 to HOH050)...');
    await Ticket.deleteMany({});

    const cleanTickets = [];
    for (let i = 1; i <= 50; i++) {
      const code = `HOH${String(i).padStart(3, '0')}`;
      cleanTickets.push({
        _id: code,
        code,
        serialNumber: i,
        qrPayload: `HOH-TICKET-${String(i).padStart(3, '0')}`,
        status: 'available',
        bookingCode: null,
        buyerName: '',
        phone: '',
        email: '',
        paymentStatus: 'Pending',
        totalAmount: 0,
        entered: false,
        enteredAt: null,
        entryCount: 0,
        notes: '',
        updatedBy: 'cleanup_script'
      });
    }

    await Ticket.insertMany(cleanTickets);
    console.log('   ✅ 50 lean tickets seeded without bloated history arrays or duplicate indexes.');

    // 7. Ensure staff accounts exist
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      console.log('\n👤 Seeding default staff credentials...');
      const defaultUsers = [
        {
          username: 'admin',
          name: 'System Admin',
          role: 'admin',
          plainPassword: process.env.DEFAULT_ADMIN_PASSWORD || 'admin@HOH2025',
          passkey: process.env.ADMIN_PASSKEY || 'hoh-admin-2025'
        },
        {
          username: 'manager',
          name: 'Event Manager',
          role: 'manager',
          plainPassword: process.env.DEFAULT_MANAGER_PASSWORD || 'manager@HOH2025',
          passkey: process.env.MANAGER_PASSKEY || 'hoh-mgr-2025'
        },
        {
          username: 'sales',
          name: 'Box Office Sales',
          role: 'sales',
          plainPassword: process.env.DEFAULT_SALES_PASSWORD || 'sales@HOH2025',
          passkey: process.env.SALES_PASSKEY || 'hoh-sales-2025'
        },
        {
          username: 'entry',
          name: 'Gate Scanner Staff',
          role: 'entry',
          plainPassword: process.env.DEFAULT_ENTRY_PASSWORD || 'entry@HOH2025',
          passkey: process.env.ENTRY_PASSKEY || 'hoh-door-2025'
        }
      ];

      for (const u of defaultUsers) {
        const passwordHash = await bcrypt.hash(u.plainPassword, 10);
        await User.create({
          username: u.username,
          name: u.name,
          role: u.role,
          passwordHash,
          passkey: u.passkey
        });
      }
      console.log('   ✅ Default staff accounts seeded.');
    }

    // 8. Post-cleanup Stats
    console.log('\n=====================================================');
    console.log('✨ CLEANUP COMPLETE — FINAL DATABASE STATUS');
    console.log('=====================================================');
    try {
      const finalStats = await db.stats();
      console.log(`   - Data Size: ${(finalStats.dataSize / 1024).toFixed(2)} KB`);
      console.log(`   - Storage Allocated: ${(finalStats.storageSize / 1024).toFixed(2)} KB`);
      console.log(`   - Total Objects: ${finalStats.objects}`);
      console.log(`   - Collections Count: ${finalStats.collections}`);
    } catch {}

    console.log('\n🚀 Database is now 100% clean, lean, and optimized for Atlas Free Tier!\n');
  } catch (err: any) {
    console.error('\n❌ Cleanup failed:', err.message);
  } finally {
    await disconnectDB();
    process.exit(0);
  }
}

runCleanup();
