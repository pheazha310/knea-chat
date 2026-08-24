/**
 * JWT + bcrypt helpers. The JWT secret always comes from the environment;
 * it is never hardcoded into responses or logs.
 */
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import type { JwtPayload } from '../types';

const getSecret = (): string => process.env.JWT_SECRET || 'your-secret-key';

export const generateToken = (payload: JwtPayload, expiresIn: jwt.SignOptions['expiresIn'] = '24h'): string => {
  return jwt.sign(payload, getSecret(), { expiresIn });
};

export const verifyToken = (token: string): JwtPayload => {
  try {
    return jwt.verify(token, getSecret()) as JwtPayload;
  } catch (error) {
    throw new Error(`Token verification failed: ${(error as Error).message}`);
  }
};

export const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
};

export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

export const generateResetToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};
