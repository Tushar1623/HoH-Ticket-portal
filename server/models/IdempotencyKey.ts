import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IIdempotencyKey extends Document {
  _id: Types.ObjectId;
  key: string;
  response: Record<string, any>;
  statusCode: number;
  createdAt: Date;
  expiresAt: Date;
}

const IdempotencyKeySchema = new Schema<IIdempotencyKey>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    response: {
      type: Schema.Types.Mixed,
      required: true
    },
    statusCode: {
      type: Number,
      default: 201
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hour TTL
      index: { expireAfterSeconds: 0 }
    }
  },
  {
    versionKey: false
  }
);

export const IdempotencyKey = mongoose.model<IIdempotencyKey>('IdempotencyKey', IdempotencyKeySchema, 'idempotencyKeys');
