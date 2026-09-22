import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { Ticket } from '../models/Ticket';
import { Admin } from '../models/Admin';
import { Counter } from '../models/Counter';
import { env } from '../config/env';

/**
 * Idempotent Database Initialization & Authoritative Repair
 * - NEVER wipes or deletes real registered customer tickets on startup.
 * - Inspects and repairs all 50 physical ticket slots (HOH001 to HOH050).
 * - For unsold/available tickets, safely repairs any malformed fields (serialNumber, null bookingId, etc.).
 * - For sold/registered tickets, preserves all customer data and only corrects structural mismatches.
 * - Validates exactly 50 tickets with 1:1 serial number mapping (1..50).
 * - Fails startup if inventory cannot be verified healthy.
 */
export async function initializeDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('Database connection is not active (readyState !== 1).');
  }

  try {
    // 1. Ensure indexes exist on Ticket collection
    await Ticket.syncIndexes().catch(() => {});

    // 2. Normalize and safely repair all 50 slots HOH001 to HOH050
    for (let i = 1; i <= 50; i++) {
      const code = `HOH${String(i).padStart(3, '0')}`;
      
      // Find ticket matching this code (case-insensitive)
      const existing = await Ticket.findOne({
        code: { $regex: new RegExp(`^${code}$`, 'i') }
      });

      if (!existing) {
        // Missing ticket: insert fresh available ticket
        await Ticket.create({
          code,
          serialNumber: i,
          status: 'available',
          bookingId: null,
          buyerName: null,
          phone: null,
          email: null,
          entered: false,
          enteredAt: null,
          entryCount: 0,
          guestsAllowed: 1,
          qrPayload: code
        });
      } else {
        // Existing ticket: check if it represents a registered/entered customer sale
        const isRegisteredOrEntered = (
          existing.bookingId !== null ||
          existing.status === 'registered' ||
          existing.status === 'entered' ||
          (existing.buyerName !== null && existing.buyerName !== '')
        );

        if (isRegisteredOrEntered) {
          // PRESERVE real customer data! Only repair structural fields if wrong.
          const structuralUpdates: any = {};
          if (existing.code !== code) structuralUpdates.code = code;
          if (existing.serialNumber !== i) structuralUpdates.serialNumber = i;
          if (!existing.qrPayload) structuralUpdates.qrPayload = code;
          if (existing.status !== 'registered' && existing.status !== 'entered' && existing.status !== 'cancelled') {
            structuralUpdates.status = existing.entered ? 'entered' : 'registered';
          }
          if (Object.keys(structuralUpdates).length > 0) {
            await Ticket.updateOne({ _id: existing._id }, { $set: structuralUpdates });
          }
        } else if (existing.status === 'cancelled' || String(existing.status).toLowerCase() === 'cancelled') {
          // Cancelled ticket: preserve cancellation reason, normalize structural fields
          await Ticket.updateOne(
            { _id: existing._id },
            {
              $set: {
                code,
                serialNumber: i,
                status: 'cancelled',
                qrPayload: code
              }
            }
          );
        } else {
          // Unsold/Available ticket: safely repair all malformed fields
          await Ticket.updateOne(
            { _id: existing._id },
            {
              $set: {
                code,
                serialNumber: i,
                status: 'available',
                bookingId: null,
                buyerName: null,
                phone: null,
                email: null,
                entered: false,
                enteredAt: null,
                entryCount: 0,
                guestsAllowed: 1,
                qrPayload: code
              },
              $unset: {
                cancellationReason: 1,
                registeredAt: 1
              }
            }
          );
        }
      }
    }

    // 3. Clean up any duplicate records if more than 1 document exists for a code
    const duplicateAgg = await Ticket.aggregate([
      { $group: { _id: "$code", count: { $sum: 1 }, docs: { $push: { id: "$_id", bookingId: "$bookingId", status: "$status" } } } },
      { $match: { count: { $gt: 1 } } }
    ]);

    for (const dup of duplicateAgg) {
      console.warn(`⚠️ Found ${dup.count} duplicate records for code ${dup._id}. Resolving safely...`);
      // Keep the one with bookingId/registered if any, else keep the first
      const sortedDocs = dup.docs.sort((a: any, b: any) => {
        if (a.bookingId && !b.bookingId) return -1;
        if (!a.bookingId && b.bookingId) return 1;
        return 0;
      });
      const keepId = sortedDocs[0].id;
      const removeIds = sortedDocs.slice(1).map((d: any) => d.id);
      await Ticket.deleteMany({ _id: { $in: removeIds } });
    }

    // 4. Ensure single Admin user exists
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

    // 5. Ensure booking counter exists
    const counter = await Counter.findById('bookingCode');
    if (!counter) {
      await Counter.create({ _id: 'bookingCode', seq: 0 });
    }

    // 6. Strict Inventory Integrity Verification
    const allTickets = await Ticket.find({}).sort({ serialNumber: 1 }).lean();
    const total = allTickets.length;
    let validCodesCount = 0;
    let validSerialsCount = 0;
    let availableCount = 0;
    let registeredCount = 0;
    let enteredCount = 0;
    let cancelledCount = 0;
    let invalidCount = 0;

    const expectedCodes = new Set(Array.from({ length: 50 }, (_, idx) => `HOH${String(idx + 1).padStart(3, '0')}`));

    for (const t of allTickets) {
      let isTicketValid = true;

      // Validate code
      if (expectedCodes.has(t.code)) {
        validCodesCount++;
      } else {
        isTicketValid = false;
      }

      // Validate serialNumber
      const match = t.code.match(/^HOH(\d+)$/i);
      const expectedSerial = match ? parseInt(match[1], 10) : -1;
      if (t.serialNumber === expectedSerial && t.serialNumber >= 1 && t.serialNumber <= 50) {
        validSerialsCount++;
      } else {
        isTicketValid = false;
      }

      // Validate status & relationships
      if (t.status === 'available') {
        if (t.bookingId === null) {
          availableCount++;
        } else {
          isTicketValid = false;
        }
      } else if (t.status === 'registered') {
        if (t.bookingId !== null) {
          registeredCount++;
        } else {
          isTicketValid = false;
        }
      } else if (t.status === 'entered') {
        if (t.bookingId !== null && t.entered === true) {
          enteredCount++;
        } else {
          isTicketValid = false;
        }
      } else if (t.status === 'cancelled') {
        cancelledCount++;
      } else {
        isTicketValid = false;
      }

      if (!isTicketValid) {
        invalidCount++;
      }
    }

    console.log('\nHOH INVENTORY INTEGRITY CHECK\n');
    console.log(`Total tickets: ${total}`);
    console.log(`Valid codes: ${validCodesCount}`);
    console.log(`Valid serial numbers: ${validSerialsCount}`);
    console.log(`Available: ${availableCount}`);
    console.log(`Registered: ${registeredCount}`);
    console.log(`Entered: ${enteredCount}`);
    console.log(`Cancelled: ${cancelledCount}`);
    console.log(`Invalid: ${invalidCount}\n`);

    if (total !== 50 || validCodesCount !== 50 || validSerialsCount !== 50 || invalidCount > 0) {
      throw new Error(
        `Inventory integrity validation failed: Total=${total}, ValidCodes=${validCodesCount}, ValidSerials=${validSerialsCount}, Invalid=${invalidCount}`
      );
    }
  } catch (err: any) {
    console.error('❌ Database initialization error:', err.message);
    throw err;
  }
}
