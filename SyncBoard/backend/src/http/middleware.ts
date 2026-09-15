import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

import path from 'path';
dotenv.config(); // Load JWT_SECRET from .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const JWT_SECRET = process.env.JWT_SECRET as string;
console.log("Jwt in middleare: ",JWT_SECRET);

// Extend Express Request type to include userId
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function middleware(req: Request, res: Response, next: NextFunction) {
  const rawToken = req.headers["authorization"];

  if (!rawToken) {
    return res.status(401).json({ message: "Authorization token missing" });
  }

  const token = rawToken.startsWith("Bearer ") ? rawToken.slice(7) : rawToken;

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    req.userId = decoded.userId;
    next();
  } catch (err) {
    console.error("JWT verification failed:", err);
    return res.status(403).json({ message: "Invalid or expired token" });
  }
}
