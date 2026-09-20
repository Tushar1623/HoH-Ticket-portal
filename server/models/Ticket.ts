import mongoose, { Schema, Document, Types } from 'mongoose';

export type TicketDbStatus = 'available' | 'reserved' | 'active' | 'entered' | 'cancelled' | 'refunded';

export interface ITicket extends Document {
  _id: Types.ObjectId;
  code: string;
  serialNumber: number;
  qrPayload: string;
  bookingId: Types.ObjectId | null;
  status: TicketDbStatus;
  entered: boolean;
  enteredAt: Date | null;
  entryCount: number;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

const TicketSchema = new Schema<ITicket>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true
    },
    serialNumber: {
      type: Number,
      required: true,
      unique: true,
      min: 1,
      max: 50,
      index: true
    },
    qrPayload: {
      type: String,
      required: true,
      trim: true
    },
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true
    },
    status: {
      type: String,
      enum: ['available', 'reserved', 'active', 'entered', 'cancelled', 'refunded'],
      default: 'available',
      index: true,
      required: true
    },
    entered: {
      type: Boolean,
      default: false,
      index: true,
      required: true
    },
    enteredAt: {
      type: Date,
      default: null
    },
    entryCount: {
      type: Number,
      default: 0,
      min: 0
    },
    version: {
      type: Number,
      default: 1
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);



export const Ticket = mongoose.model<ITicket>('Ticket', TicketSchema, 'tickets');
