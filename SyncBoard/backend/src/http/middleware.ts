import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

import path from 'path';
dotenv.config(); // Load JWT_SECRET from .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
import { JWT_SECRET } from "../config";

// Extend Express Request type to include userId
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function middleware(req: Request, res: Response, next: NextFunction) {
  let token = req.headers["authorization"];

  if (!token) {
    return res.status(401).json({ message: "Authorization token missing" });
  }

  if (token.startsWith("Bearer ")) {
    token = token.slice(7).trim();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid or expired token" });
  }
}
