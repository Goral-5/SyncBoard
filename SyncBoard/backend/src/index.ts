import http from 'http';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
import { createExpressApp } from './http/server';
import { attachWebSocketServer } from './ws/index';

import path from 'path';
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Ensure MongoDB Atlas SRV records resolve reliably across all DNS providers/Windows environments
dns.setServers(['8.8.8.8', '1.1.1.1']);

import { MONGO_URI, PORT } from './config';

async function startServer() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');
    console.log('📦 Database:', mongoose.connection.name);
    console.log('🗄️ Host:', mongoose.connection.host);

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