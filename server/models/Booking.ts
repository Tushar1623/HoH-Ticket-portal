import mongoose, { Schema, Document, Types } from 'mongoose';

export type PaymentStatus =
  | 'Pending'
  | 'Paid'
  | 'Complimentary'
  | 'Refunded'
  | 'Cancelled'
  | 'PAID'
  | 'PARTIAL'
  | 'PENDING';

export type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'OTHER';

export interface IBooking extends Document {
  _id: Types.ObjectId;
  bookingCode: string;
  buyerName: string;
  phone: string;
  email: string;
  ticketQuantity: number;
  ticketCodes: string[];
  paymentStatus: PaymentStatus;
  totalAmount: number;
  amountPaid: number;
  paymentMethod: PaymentMethod;
  notes: string;
  source: 'OFFLINE' | 'ONLINE';
  anchorTicketCode?: string | null;
  allocationMethod: 'CONSECUTIVE' | 'MANUAL';
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BookingSchema = new Schema<IBooking>(
  {
    bookingCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true
    },
    buyerName: {
      type: String,
      required: true,
      trim: true
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    email: {
      type: String,
      trim: true,
      default: '',
      index: true
    },
    ticketQuantity: {
      type: Number,
      required: true,
      min: 1,
      max: 50
    },
    ticketCodes: {
      type: [String],
      required: true,
      validate: [(val: string[]) => val.length > 0, 'At least one ticket code is required']
    },
    paymentStatus: {
      type: String,
      enum: ['Pending', 'Paid', 'Complimentary', 'Refunded', 'Cancelled', 'PAID', 'PARTIAL', 'PENDING'],
      default: 'PAID',
      required: true
    },
    totalAmount: {
      type: Number,
      required: true,
      default: 0
    },
    amountPaid: {
      type: Number,
      required: true,
      default: function (this: any) {
        return this.totalAmount || 0;
      }
    },
    paymentMethod: {
      type: String,
      enum: ['CASH', 'UPI', 'CARD', 'OTHER'],
      default: 'CASH',
      required: true
    },
    notes: {
      type: String,
      default: '',
      trim: true
    },
    source: {
      type: String,
      enum: ['OFFLINE', 'ONLINE'],
      default: 'OFFLINE',
      required: true
    },
    anchorTicketCode: {
      type: String,
      default: null,
      trim: true
    },
    allocationMethod: {
      type: String,
      enum: ['CONSECUTIVE', 'MANUAL'],
      default: 'CONSECUTIVE',
      required: true
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'Admin',
      default: null
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

export const Booking = mongoose.model<IBooking>('Booking', BookingSchema, 'bookings');
