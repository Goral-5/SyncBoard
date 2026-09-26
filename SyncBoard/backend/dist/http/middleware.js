"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.middleware = middleware;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config(); // Load JWT_SECRET from .env
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../.env') });
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../../.env') });
const config_1 = require("../config");
function middleware(req, res, next) {
    let token = req.headers["authorization"];
    if (!token) {
        return res.status(401).json({ message: "Authorization token missing" });
    }
    if (token.startsWith("Bearer ")) {
        token = token.slice(7).trim();
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, config_1.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    }
    catch (err) {
        return res.status(403).json({ message: "Invalid or expired token" });
    }
}
