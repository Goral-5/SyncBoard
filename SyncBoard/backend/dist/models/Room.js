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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomInMemory = exports.RoomState = exports.RoomModel = exports.Room = void 0;
exports.getRoomUserRole = getRoomUserRole;
const mongoose_1 = __importStar(require("mongoose"));
const roomSchema = new mongoose_1.Schema({
    slug: { type: String, required: true, unique: true },
    adminId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User', required: true },
    collaborators: [{ type: mongoose_1.default.Schema.Types.ObjectId, ref: 'User' }],
    elements: { type: mongoose_1.Schema.Types.Mixed, default: [] },
    version: { type: Number, default: 0 },
}, {
    timestamps: true,
});
roomSchema.index({ adminId: 1 });
exports.Room = mongoose_1.default.model('Room', roomSchema);
exports.RoomModel = exports.Room;
// -------------------------------------------------------------
// Quick permission helper:
// Checks who is calling:
// - Room owner (adminId) gets 'admin' rights (can edit, invite, delete room)
// - Invited teammate (in collaborators array) gets 'editor' rights (can draw and modify)
// - Anyone else returns null (access denied)
// -------------------------------------------------------------
function getRoomUserRole(room, userId) {
    var _a;
    if (!room || !userId)
        return null;
    const uid = userId.toString();
    const adminId = (((_a = room.adminId) === null || _a === void 0 ? void 0 : _a._id) || room.adminId).toString();
    if (adminId === uid)
        return 'admin';
    if (Array.isArray(room.collaborators)) {
        const isCollab = room.collaborators.some((c) => ((c === null || c === void 0 ? void 0 : c._id) || c).toString() === uid);
        if (isCollab)
            return 'editor';
    }
    return null;
}
// ==========================================
// Re-export RoomState from ws/roomManager
// ==========================================
var roomManager_1 = require("../ws/roomManager");
Object.defineProperty(exports, "RoomState", { enumerable: true, get: function () { return roomManager_1.RoomState; } });
Object.defineProperty(exports, "RoomInMemory", { enumerable: true, get: function () { return roomManager_1.RoomState; } });
