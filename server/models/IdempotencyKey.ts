import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IIdempotencyKey extends Document {
  _id: Types.ObjectId;
  key?: string;
  requestId?: string;
  action: string;
  response: Record<string, any>;
  statusCode: number;
  createdAt: Date;
  expiresAt: Date;
}

const IdempotencyKeySchema = new Schema<IIdempotencyKey>(
  {
    key: {
      type: String,
      index: true
    },
    requestId: {
      type: String,
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

IdempotencyKeySchema.pre('save', function () {
  if (this.key && !this.requestId) this.requestId = this.key;
  if (this.requestId && !this.key) this.key = this.requestId;
});

IdempotencyKeySchema.index({ key: 1, action: 1 });
IdempotencyKeySchema.index({ requestId: 1, action: 1 });

export const IdempotencyKey = mongoose.model<IIdempotencyKey>('IdempotencyKey', IdempotencyKeySchema, 'idempotencyKeys');
