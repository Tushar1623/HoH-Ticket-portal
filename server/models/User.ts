import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export type StaffRole = 'sales' | 'entry' | 'manager' | 'admin';
export type UserRole = StaffRole;

export interface IUser extends Document {
  username: string;
  name: string;
  role: StaffRole;
  passwordHash: string;
  passkey: string;
  isActive: boolean;
  comparePassword(candidatePassword: string): Promise<boolean>;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    role: {
      type: String,
      enum: ['sales', 'entry', 'manager', 'admin'],
      required: true,
      index: true
    },
    passwordHash: {
      type: String,
      required: true
    },
    passkey: {
      type: String,
      required: true,
      index: true
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

UserSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

export const User = mongoose.model<IUser>('User', UserSchema, 'users');
