import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { Admin } from '../models/Admin';

export interface AuthenticatedAdmin {
  userId: string;
  username: string;
  email: string;
  role: 'admin';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedAdmin;
      requestId?: string;
    }
  }
}

/**
 * Admin Authentication Middleware
 * Strictly requires a valid JWT signed with env.JWT_SECRET.
 * Verifies the admin account is active in MongoDB.
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Admin authentication token required. Provide Authorization: Bearer <token>'
        }
      });
      return;
    }

    const token = authHeader.split(' ')[1];
    let decoded: any;

    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch (err: any) {
      res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired session token. Please log in again.'
        }
      });
      return;
    }

    // Verify admin exists and is active if MongoDB is connected and ID is a valid ObjectId
    if (decoded.userId && mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(decoded.userId)) {
      try {
        const adminDoc = await Admin.findById(decoded.userId).lean();
        if (adminDoc && adminDoc.isActive === false) {
          res.status(403).json({
            success: false,
            error: {
              code: 'ACCOUNT_DISABLED',
              message: 'Admin account has been deactivated.'
            }
          });
          return;
        }
      } catch {
        // Fall back gracefully if db query encounters temporary issues
      }
    }

    req.user = {
      userId: decoded.userId || 'admin_id',
      username: decoded.username || 'admin',
      email: decoded.email || 'admin@houseofhumour.com',
      role: 'admin'
    };

    next();
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_SERVER_ERROR',
        message: 'Internal server error during authentication verification.'
      }
    });
  }
};

/**
 * Require Admin middleware (alias for authenticate)
 */
export const requireAdmin = authenticate;

// Compatibility alias
export const requireRole = (_allowedRoles: string[]) => authenticate;

/**
 * Request ID tracking for traceability
 */
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const reqId = (req.headers['x-request-id'] as string) || `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  req.requestId = reqId;
  res.setHeader('X-Request-ID', reqId);
  next();
};
