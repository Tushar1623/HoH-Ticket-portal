import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'hoh-jwt-secret-key-2025';

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password, passkey } = req.body;

    let user;
    if (passkey) {
      user = await User.findOne({ passkey: passkey.trim() });
      if (!user) {
        res.status(401).json({ success: false, error: 'Invalid staff passkey.' });
        return;
      }
    } else if (username && password) {
      user = await User.findOne({ username: username.trim().toLowerCase() });
      if (!user) {
        res.status(401).json({ success: false, error: 'Invalid username or password.' });
        return;
      }
      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        res.status(401).json({ success: false, error: 'Invalid username or password.' });
        return;
      }
    } else {
      res.status(400).json({ success: false, error: 'Provide username/password or staff passkey.' });
      return;
    }

    const payload = {
      userId: user._id.toString(),
      username: user.username,
      name: user.name,
      role: user.role
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });

    res.json({
      success: true,
      token,
      user: payload
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Login failed.' });
  }
};

export const getMe = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Not authenticated.' });
    return;
  }
  res.json({
    success: true,
    user: req.user
  });
};
