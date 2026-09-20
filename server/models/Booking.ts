import mongoose, { Schema, Document, Types } from 'mongoose';

export type PaymentStatus = 'Pending' | 'Paid' | 'Complimentary' | 'Refunded' | 'Cancelled';

export interface IBooking extends Document {
  _id: Types.ObjectId;
  bookingCode: string;
  buyerName: string;
  phone: string;
  email?: string;
  ticketQuantity: number;
  ticketCodes: string[];
  paymentStatus: PaymentStatus;
  totalAmount: number;
  notes?: string;
  createdBy?: {
    userId?: Types.ObjectId;
    name?: string;
    role?: 'sales' | 'manager' | 'admin';
  };
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
      trim: true
    },
    email: {
      type: String,
      trim: true,
      default: ''
    },
    ticketQuantity: {
      type: Number,
      required: true,
      min: 1,
      max: 10
    },
    ticketCodes: {
      type: [String],
      required: true,
      validate: [(val: string[]) => val.length > 0, 'At least one ticket code is required']
    },
    paymentStatus: {
      type: String,
      enum: ['Pending', 'Paid', 'Complimentary', 'Refunded', 'Cancelled'],
      default: 'Paid',
      required: true
    },
    totalAmount: {
      type: Number,
      required: true,
      default: 0
    },
    notes: {
      type: String,
      default: '',
      trim: true
    },
    createdBy: {
      userId: { type: Schema.Types.ObjectId, ref: 'User' },
      name: { type: String, default: 'Staff' },
      role: { type: String, enum: ['sales', 'manager', 'admin'], default: 'sales' }
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);



export const Booking = mongoose.model<IBooking>('Booking', BookingSchema, 'bookings');
