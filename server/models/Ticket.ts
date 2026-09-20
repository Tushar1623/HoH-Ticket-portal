import mongoose, { Schema, Document, Types } from 'mongoose';

export type TicketStatus = 'available' | 'registered' | 'cancelled' | 'AVAILABLE' | 'REGISTERED';

export interface ITicket extends Document {
  _id: Types.ObjectId;
  code: string;
  serialNumber: number;
  status: TicketStatus;
  bookingId: Types.ObjectId | null;
  buyerName: string | null;
  phone: string | null;
  email: string | null;
  entered: boolean;
  enteredAt: Date | null;
  entryCount: number;
  guestsAllowed: number;
  registeredAt?: Date | null;
  cancellationReason?: string | null;
  qrPayload?: string;
  createdAt: Date;
  updatedAt: Date;
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
    status: {
      type: String,
      enum: ['available', 'registered', 'cancelled', 'AVAILABLE', 'REGISTERED'],
      default: 'available',
      index: true,
      required: true
    },
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true
    },
    buyerName: {
      type: String,
      default: null,
      trim: true
    },
    phone: {
      type: String,
      default: null,
      trim: true
    },
    email: {
      type: String,
      default: null,
      trim: true
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
    guestsAllowed: {
      type: Number,
      default: 1,
      min: 1
    },
    registeredAt: {
      type: Date,
      default: null
    },
    cancellationReason: {
      type: String,
      enum: ['LOST', 'DAMAGED', 'VOID', 'OTHER', null],
      default: null
    },
    qrPayload: {
      type: String,
      trim: true,
      default: function (this: any) {
        return this.code;
      }
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

export const Ticket = mongoose.model<ITicket>('Ticket', TicketSchema, 'tickets');
