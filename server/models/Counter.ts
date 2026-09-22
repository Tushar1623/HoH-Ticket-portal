import mongoose, { Schema, Document } from 'mongoose';

export interface ICounter {
  _id: string;
  seq: number;
}

const CounterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});

export const Counter = mongoose.model<ICounter>('Counter', CounterSchema, 'counters');

/**
 * Generate a guaranteed unique, atomic, concurrent-safe booking code
 * Format: HOH-BOOK-000001
 */
export async function getNextBookingCode(): Promise<string> {
  const counter = await Counter.findByIdAndUpdate(
    'bookingCode',
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  const num = String(counter.seq).padStart(6, '0');
  return `HOH-BOOK-${num}`;
}
