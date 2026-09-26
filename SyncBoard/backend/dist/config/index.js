"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MONGO_URI = exports.PORT = exports.JWT_SECRET = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../.env') });
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../../.env') });
exports.JWT_SECRET = process.env.JWT_SECRET || 'syncboard-dev-secret-2024';
exports.PORT = parseInt(process.env.PORT || '5000', 10);
exports.MONGO_URI = process.env.MONGO_URI || '';
