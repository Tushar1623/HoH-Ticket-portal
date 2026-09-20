import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IIdempotencyKey extends Document {
  _id: Types.ObjectId;
  requestId: string;
  action: string;
  response: Record<string, any>;
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
      required: true
    },
    response: {
      type: Schema.Types.Mixed,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 } // TTL index automatically removes expired keys
    }
  },
  {
    versionKey: false
  }
);



export const IdempotencyKey = mongoose.model<IIdempotencyKey>('IdempotencyKey', IdempotencyKeySchema, 'idempotencyKeys');
