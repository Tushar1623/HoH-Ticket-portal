import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { User, UserRole } from '../models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'hoh-jwt-secret-key-2025';

export interface AuthenticatedUser {
  userId?: string;
  username: string;
  name: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      requestId?: string;
    }
  }
}

/**
 * Authentication middleware supporting both Bearer JWT and X-Staff-Passkey
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const passkeyHeader = req.headers['x-staff-passkey'] as string | undefined;

    // 1. Bearer Token Authentication
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as AuthenticatedUser;
        req.user = decoded;
        return next();
      } catch (err) {
        res.status(401).json({ success: false, error: 'Invalid or expired token.' });
        return;
      }
    }

    // 2. Staff Passkey Authentication
    if (passkeyHeader) {
      const matchedUser = await User.findOne({ passkey: passkeyHeader.trim() }).lean();
      if (matchedUser) {
        req.user = {
          userId: matchedUser._id.toString(),
          username: matchedUser.username,
          name: matchedUser.name,
          role: matchedUser.role
        };
        return next();
      } else {
        res.status(401).json({ success: false, error: 'Invalid staff passkey.' });
        return;
      }
    }

    res.status(401).json({ success: false, error: 'Authentication required. Provide Authorization Bearer token or X-Staff-Passkey header.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Internal server error during authentication.' });
  }
};

/**
 * Role-based authorization middleware
 */
export const requireRole = (allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required.' });
      return;
    }

    // Admin has superuser access to all endpoints
    if (req.user.role === 'admin' || allowedRoles.includes(req.user.role)) {
      return next();
    }

    res.status(403).json({
      success: false,
      error: `Access denied. Requires role: [${allowedRoles.join(', ')}]. Your role: ${req.user.role}`
    });
  };
};

/**
 * Request ID tracking middleware for idempotency & audit logging
 */
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const reqId = (req.headers['x-request-id'] as string) || `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  req.requestId = reqId;
  res.setHeader('X-Request-ID', reqId);
  next();
};

/**
 * Rate limiters
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

export const entryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, error: 'Gate scanner rate limit exceeded. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { success: false, error: 'API rate limit reached. Please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false
});
