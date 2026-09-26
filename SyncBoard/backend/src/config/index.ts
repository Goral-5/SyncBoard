import dotenv from 'dotenv';
import path from 'path';

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const JWT_SECRET: string = process.env.JWT_SECRET || 'syncboard-dev-secret-2024';
export const PORT: number = parseInt(process.env.PORT || '5000', 10);
export const MONGO_URI: string = process.env.MONGO_URI || '';