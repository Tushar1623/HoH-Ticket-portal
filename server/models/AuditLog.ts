import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IAuditLog extends Document {
  _id: Types.ObjectId;
  requestId: string;
  action: string;
  ticketCode?: string | null;
  bookingId?: Types.ObjectId | null;
  previousValue?: Record<string, any>;
  newValue?: Record<string, any>;
  reason: string;
  performedBy: {
    userId?: Types.ObjectId;
    name?: string;
    role?: string;
  };
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    requestId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    action: {
      type: String,
      required: true,
      index: true
    },
    ticketCode: {
      type: String,
      default: null,
      index: true
    },
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      default: null
    },
    previousValue: {
      type: Schema.Types.Mixed,
      default: {}
    },
    newValue: {
      type: Schema.Types.Mixed,
      default: {}
    },
    reason: {
      type: String,
      required: true,
      default: 'Operation performed'
    },
    performedBy: {
      userId: { type: Schema.Types.ObjectId, ref: 'User' },
      name: { type: String, default: 'System' },
      role: { type: String, default: 'system' }
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false
  }
);

AuditLogSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema, 'auditLogs');
