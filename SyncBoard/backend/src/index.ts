import http from 'http';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { createExpressApp } from './http/server';
import { attachWebSocketServer } from './ws/index';

import path from 'path';
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGO_URI = process.env.MONGO_URI!;
const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const app = createExpressApp();
    const server = http.createServer(app);

    attachWebSocketServer(server);

    server.listen(PORT, () => {
      console.log(`🚀 HTTP Server: http://localhost:${PORT}`);
      console.log(`🔌 WebSocket Server: ws://localhost:${PORT}`); // New Log
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
  }
}

startServer();