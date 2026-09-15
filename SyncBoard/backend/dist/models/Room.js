"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Room = void 0;
exports.checkRoomPermission = checkRoomPermission;
const mongoose_1 = __importStar(require("mongoose"));
const roomSchema = new mongoose_1.Schema({
    slug: { type: String, required: true, unique: true },
    adminId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User', required: true },
    collaborators: [{ type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User' }],
    elements: [{ type: mongoose_1.Schema.Types.Mixed }],
    version: { type: Number, default: 0 },
}, { timestamps: true });
exports.Room = mongoose_1.default.model('Room', roomSchema);
function checkRoomPermission(userId, roomIdOrSlug) {
    return __awaiter(this, void 0, void 0, function* () {
        const isObjectId = mongoose_1.default.Types.ObjectId.isValid(roomIdOrSlug) && /^[0-9a-fA-F]{24}$/.test(roomIdOrSlug);
        const room = yield exports.Room.findOne(isObjectId ? { $or: [{ _id: roomIdOrSlug }, { slug: roomIdOrSlug }] } : { slug: roomIdOrSlug });
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
    });
}
