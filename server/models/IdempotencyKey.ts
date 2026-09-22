import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IIdempotencyKey extends Document {
  _id: Types.ObjectId;
  requestId: string;
  action: string;
  response: Record<string, any>;
  statusCode: number;
  createdAt: Date;
  expiresAt: Date;
}

const IdempotencyKeySchema = new Schema<IIdempotencyKey>(
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
      default: 'OFFLINE_SALE_CREATED',
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
      required: true,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hour TTL
      index: { expireAfterSeconds: 0 }
    }
  },
  {
    versionKey: false
  }
);

IdempotencyKeySchema.index({ requestId: 1, action: 1 });

export const IdempotencyKey = mongoose.model<IIdempotencyKey>('IdempotencyKey', IdempotencyKeySchema, 'idempotencyKeys');
