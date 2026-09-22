import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { Ticket } from '../models/Ticket';
import { Admin } from '../models/Admin';
import { Counter } from '../models/Counter';
import { env } from '../config/env';

/**
 * Idempotent Database Initialization
 * - NEVER wipes or deletes existing tickets on startup.
 * - Checks for missing tickets between HOH001 and HOH050 and inserts only missing ones.
 * - Ensures Admin user exists.
 * - Ensures atomic booking code counter is initialized.
 */
export async function initializeDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('Database connection is not active (readyState !== 1).');
  }

  try {
    // 1. Normalize any legacy ticket statuses in existing documents
    await Ticket.updateMany(
      { status: 'AVAILABLE' as any },
      { $set: { status: 'available' } }
    );
    await Ticket.updateMany(
      { status: 'CANCELLED' as any },
      { $set: { status: 'cancelled' } }
    );
    await Ticket.updateMany(
      { entered: true, status: { $ne: 'cancelled' } },
      { $set: { status: 'entered' } }
    );
    await Ticket.updateMany(
      {
        status: { $in: ['REGISTERED', 'active', 'reserved'] as any },
        entered: { $ne: true },
        $or: [{ bookingId: { $ne: null } }, { buyerName: { $ne: null } }]
      },
      { $set: { status: 'registered' } }
    );
    await Ticket.updateMany(
      {
        status: { $in: ['REGISTERED', 'active', 'reserved'] as any },
        bookingId: null,
        buyerName: null,
        entered: false
      },
      { $set: { status: 'available' } }
    );

    // 2. Idempotently ensure exactly 50 tickets HOH001 to HOH050 exist
    const existingTickets = await Ticket.find({}, { code: 1, serialNumber: 1 }).lean();
    const existingCodes = new Set(existingTickets.map(t => t.code.toUpperCase()));
    const missingTickets = [];

    for (let i = 1; i <= 50; i++) {
      const code = `HOH${String(i).padStart(3, '0')}`;
      if (!existingCodes.has(code)) {
        missingTickets.push({
          code,
          serialNumber: i,
          status: 'available',
          bookingId: null,
          buyerName: null,
          phone: null,
          email: null,
          entered: false,
          enteredAt: null,
          qrPayload: code
        });
      }
    }

    if (missingTickets.length > 0) {
      console.log(`🌱 Idempotently inserting ${missingTickets.length} missing ticket(s)...`);
      await Ticket.insertMany(missingTickets);
      console.log(`✅ ${missingTickets.length} ticket(s) inserted.`);
    } else {
      console.log(`ℹ️ All 50 tickets (HOH001 to HOH050) verified in database.`);
    }

    // 3. Ensure single Admin user exists
    const adminCount = await Admin.countDocuments();
    if (adminCount === 0) {
      console.log('👤 Initializing default Admin account...');
      const adminPass = env.ADMIN_PASSWORD;
      if (!adminPass) {
        throw new Error('ADMIN_PASSWORD environment variable is required to initialize the admin account.');
      }
      const passwordHash = await bcrypt.hash(adminPass, 10);
      await Admin.create({
        username: 'admin',
        email: env.ADMIN_EMAIL || 'admin@houseofhumour.com',
        name: 'System Admin',
        passwordHash,
        isActive: true
      });
      console.log('✅ Admin account verified: username=admin');
    }

    // 4. Ensure booking counter exists
    const counter = await Counter.findById('bookingCode');
    if (!counter) {
      await Counter.create({ _id: 'bookingCode', seq: 0 });
    }

    // 5. Authoritative Ticket Inventory Verification Logging
    const total = await Ticket.countDocuments();
    const available = await Ticket.countDocuments({ status: 'available', bookingId: null });
    const registered = await Ticket.countDocuments({ status: 'registered', bookingId: { $ne: null } });
    const entered = await Ticket.countDocuments({ status: 'entered', entered: true });
    const cancelled = await Ticket.countDocuments({ status: 'cancelled' });

    console.log('\nHOH ticket inventory verification:');
    console.log(`Total: ${total}`);
    console.log(`Available: ${available}`);
    console.log(`Registered: ${registered}`);
    console.log(`Entered: ${entered}`);
    console.log(`Cancelled: ${cancelled}\n`);
  } catch (err: any) {
    console.error('❌ Database initialization error:', err.message);
    throw err;
  }
}
