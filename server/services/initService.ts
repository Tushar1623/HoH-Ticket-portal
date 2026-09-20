import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { Ticket } from '../models/Ticket';
import { User } from '../models/User';

export async function initializeDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 1) {
    console.log('ℹ️ MongoDB connection not active yet (readyState !== 1). Skipping init until connected.');
    return;
  }
  try {
    // 1. Seed/ensure exactly 50 tickets HOH001 to HOH050
    const existingTickets = await Ticket.find().lean();
    const needsInit = existingTickets.length !== 50 || existingTickets.some(t => !t.serialNumber || !t.status);

    if (needsInit) {
      console.log('🌱 Seeding / formatting exactly 50 tickets (HOH001 to HOH050)...');
      // If no bookings exist, cleanly re-seed the 50 tickets
      await Ticket.deleteMany({});
      const ticketsToInsert = [];
      const now = new Date();

      for (let i = 1; i <= 50; i++) {
        const code = `HOH${String(i).padStart(3, '0')}`;
        ticketsToInsert.push({
          code,
          serialNumber: i,
          qrPayload: code, // Exact match: "HOH001"
          bookingId: null,
          status: 'available',
          entered: false,
          enteredAt: null,
          entryCount: 0,
          version: 1,
          createdAt: now,
          updatedAt: now
        });
      }
      await Ticket.insertMany(ticketsToInsert);
      console.log('✅ Successfully seeded exactly 50 tickets (HOH001 to HOH050).');
    } else {
      console.log(`ℹ️ Tickets collection initialized with ${existingTickets.length} tickets.`);
    }

    // 2. Seed staff users if empty
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      console.log('🌱 Seeding default staff accounts...');
      const adminPass = process.env.ADMIN_PASSWORD || 'admin@HOH2025';
      const defaultUsers = [
        {
          username: 'admin',
          name: 'System Admin',
          role: 'admin',
          plainPassword: adminPass,
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
      console.log('✅ Successfully seeded staff accounts: admin, manager, sales, entry.');
    }
  } catch (err: any) {
    console.error('❌ Database initialization error:', err.message);
  }
}
