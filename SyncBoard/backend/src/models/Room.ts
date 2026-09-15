import mongoose, { Schema, Document } from 'mongoose';

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
    elements: [{ type: Schema.Types.Mixed }],
    version: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Room = mongoose.model<IRoom>('Room', roomSchema);

export async function checkRoomPermission(
  userId: string,
  roomIdOrSlug: string
): Promise<{ allowed: boolean; role: 'admin' | 'editor' | null; room: IRoom | null }> {
  const isObjectId = mongoose.Types.ObjectId.isValid(roomIdOrSlug) && /^[0-9a-fA-F]{24}$/.test(roomIdOrSlug);
  const room = await Room.findOne(
    isObjectId ? { $or: [{ _id: roomIdOrSlug }, { slug: roomIdOrSlug }] } : { slug: roomIdOrSlug }
  );

  if (!room) {
    return { allowed: false, role: null, room: null };
  }

  const userIdStr = userId.toString();
  if (room.adminId.toString() === userIdStr) {
    return { allowed: true, role: 'admin', room };
  }

  const isCollaborator = room.collaborators.some((c) => c.toString() === userIdStr);
  if (isCollaborator) {
    return { allowed: true, role: 'editor', room };
  }

  return { allowed: false, role: null, room };
}

