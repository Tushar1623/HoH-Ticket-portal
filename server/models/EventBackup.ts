import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IEventBackup extends Document {
  _id: Types.ObjectId;
  resetToken: string;
  reason: string;
  performedBy: {
    userId?: Types.ObjectId;
    name?: string;
    role?: string;
  };
  ticketsSnapshot: any[];
  bookingsSnapshot: any[];
  createdAt: Date;
}

const EventBackupSchema = new Schema<IEventBackup>(
  {
    resetToken: {
      type: String,
      required: true,
      index: true
    },
    reason: {
      type: String,
      required: true
    },
    performedBy: {
      userId: { type: Schema.Types.ObjectId, ref: 'User' },
      name: { type: String, default: 'Admin' },
      role: { type: String, default: 'admin' }
    },
    ticketsSnapshot: {
      type: [Schema.Types.Mixed] as any,
      default: []
    },
    bookingsSnapshot: {
      type: [Schema.Types.Mixed] as any,
      default: []
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

EventBackupSchema.index({ createdAt: -1 });

export const EventBackup = mongoose.model<IEventBackup>('EventBackup', EventBackupSchema, 'eventBackups');
