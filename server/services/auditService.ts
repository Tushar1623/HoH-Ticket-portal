import mongoose from 'mongoose';
import { AuditLog } from '../models/AuditLog';

export async function logAudit(params: {
  action: string;
  ticketCode?: string | null;
  bookingId?: any;
  previousValue?: any;
  newValue?: any;
  reason?: string;
  adminUsername?: string;
  requestId?: string;
}): Promise<void> {
  try {
    if (mongoose.connection.readyState !== 1) {
      return;
    }
    const requestId = params.requestId || `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    await AuditLog.create({
      requestId,
      action: params.action,
      ticketCode: params.ticketCode || null,
      bookingId: params.bookingId || null,
      previousValue: params.previousValue || {},
      newValue: params.newValue || {},
      reason: params.reason || 'Admin action executed',
      performedBy: {
        name: params.adminUsername || 'admin',
        role: 'admin'
      }
    });
  } catch (err: any) {
    // Non-blocking: audit failure does not break the admin operation
    console.warn('Non-fatal audit log warning:', err.message);
  }
}
