import mongoose, { Schema, Document } from 'mongoose';
import { RoomSnapshot, ElementMutationResult, RoomRevision } from '../types/room';

export type { RoomSnapshot, ElementMutationResult, RoomRevision };

// ==========================================
// 1. Persistent Database Types & Mongoose Model
// ==========================================

export interface IRoom extends Document {
  slug: string;
  adminId: mongoose.Types.ObjectId;
  collaborators: mongoose.Types.ObjectId[];
  elements: any[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const roomSchema = new Schema<IRoom>(
  {
    slug: { type: String, required: true, unique: true },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    collaborators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    elements: { type: Schema.Types.Mixed, default: [] },
    version: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

roomSchema.index({ adminId: 1 });

export const Room = mongoose.model<IRoom>('Room', roomSchema);
export const RoomModel = Room;

// -------------------------------------------------------------
// Quick permission helper:
// Checks who is calling:
// - Room owner (adminId) gets 'admin' rights (can edit, invite, delete room)
// - Invited teammate (in collaborators array) gets 'editor' rights (can draw and modify)
// - Anyone else returns null (access denied)
// -------------------------------------------------------------
export function getRoomUserRole(room: IRoom, userId: string | mongoose.Types.ObjectId): 'admin' | 'editor' | null {
  if (!room || !userId) return null;
  const uid = userId.toString();
  const adminId = (room.adminId?._id || room.adminId).toString();
  if (adminId === uid) return 'admin';
  if (Array.isArray(room.collaborators)) {
    const isCollab = room.collaborators.some((c: any) => (c?._id || c).toString() === uid);
    if (isCollab) return 'editor';
  }
  return null;
}

// ==========================================
// Re-export RoomState from ws/roomManager
// ==========================================
export { RoomState, RoomState as RoomInMemory } from '../ws/roomManager';