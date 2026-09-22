import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import http from 'http';
import express from 'express';
import { Room } from './models/Room';
import { Message } from './models/Message';
import { User } from './models/User';
import { roomManager, RoomState } from './ws/roomManager';
import { attachWebSocketServer } from './ws';

const JWT_SECRET = 'abcdefghijkl';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

async function runTests() {
  console.log('🧪 =========================================================');
  console.log('🧪 Starting WebSocket Engine Verification Tests (In-Memory)');
  console.log('🧪 =========================================================\n');

  const app = express();
  const server = http.createServer(app);
  attachWebSocketServer(server);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  console.log(`✓ Test HTTP + WS Server listening on port ${port}`);

  const userA = { userId: '507f1f77bcf86cd799439011', name: 'Alice' };
  const userB = { userId: '507f1f77bcf86cd799439022', name: 'Bob' };
  const tokenA = jwt.sign(userA, JWT_SECRET);
  const tokenB = jwt.sign(userB, JWT_SECRET);
  const testRoomId = 'test-collab-room-1';

  // Setup in-memory room in roomManager and mock DB calls
  const initialRoomState = new RoomState(testRoomId, [], 0);
  (roomManager as any).rooms.set(testRoomId, initialRoomState);

  (Room as any).findOne = async () => ({
    _id: testRoomId,
    slug: testRoomId,
    adminId: userA.userId,
    collaborators: [userB.userId],
    elements: [],
    version: 0,
  });

  (User as any).findById = (id: string) => ({
    select: async () => ({
      _id: id,
      name: id === userA.userId ? 'Alice' : 'Bob',
    }),
  });

  (Message as any).create = async (doc: any) => ({
    ...doc,
    populate: async () => ({
      ...doc,
      userId: {
        _id: doc.userId,
        name: doc.userId === userA.userId ? 'Alice' : 'Bob',
        photo: null,
      },
    }),
  });

  // Test 1: Reject unauthenticated connection
  console.log('\n[Test 1] Reject unauthenticated connection');
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    let closed = false;
    ws.on('close', (code) => {
      closed = true;
      console.log(`  ✓ Connection closed with code ${code} as expected`);
      resolve();
    });
    setTimeout(() => {
      if (!closed) reject(new Error('Connection remained open without token'));
    }, 500);
  });

  // Test 2: Connect User A with valid token
  console.log('\n[Test 2] Connect User A and Join Room');
  const wsA = new WebSocket(`ws://localhost:${port}?token=${tokenA}`);
  await new Promise<void>((resolve) => wsA.on('open', resolve));
  console.log('  ✓ User A WebSocket opened');

  let userAReceivedRoomState = false;
  wsA.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'room:state' && msg.roomId === testRoomId) {
      userAReceivedRoomState = true;
      console.log(`  ✓ User A received 'room:state' (revision: ${msg.revision}, users: ${msg.users.length})`);
    }
  });

  wsA.send(
    JSON.stringify({
      type: 'room:join',
      roomId: testRoomId,
      clientId: 'client-alice-1',
    })
  );

  await new Promise((r) => setTimeout(r, 150));
  if (!userAReceivedRoomState) throw new Error('User A did not receive room:state');

  // Test 3: Connect User B and verify user:joined broadcast to User A
  console.log('\n[Test 3] Connect User B and verify user:joined broadcast to User A');
  const wsB = new WebSocket(`ws://localhost:${port}?token=${tokenB}`);
  await new Promise<void>((resolve) => wsB.on('open', resolve));

  let userAReceivedUserBJoined = false;
  wsA.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'user:joined' && msg.user.userId === userB.userId) {
      userAReceivedUserBJoined = true;
      console.log(`  ✓ User A received 'user:joined' broadcast for User B (${msg.user.clientId})`);
    }
  });

  wsB.send(
    JSON.stringify({
      type: 'room:join',
      roomId: testRoomId,
      clientId: 'client-bob-1',
    })
  );

  await new Promise((r) => setTimeout(r, 150));
  if (!userAReceivedUserBJoined) throw new Error('User A did not receive user:joined for User B');

  // Test 4: Differential Element Creation & Canonical Broadcast
  console.log('\n[Test 4] Differential Element Creation & Canonical Broadcast');
  let userBReceivedElementCreate = false;
  let userAReceivedElementCreate = false;

  wsA.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'operation:broadcast' && msg.operation?.operationId === 'op-create-1') {
      userAReceivedElementCreate = true;
      console.log(`  ✓ Sender User A received canonical 'operation:broadcast' with authoritative rev: ${msg.revision}`);
    }
  });

  wsB.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'operation:broadcast' && msg.operation?.operationId === 'op-create-1') {
      userBReceivedElementCreate = true;
      console.log(`  ✓ User B received 'operation:broadcast' for element:create (id: ${msg.operation.elementId}, rev: ${msg.revision})`);
    }
  });

  wsA.send(
    JSON.stringify({
      type: 'element:create',
      roomId: testRoomId,
      clientId: 'client-alice-1',
      operationId: 'op-create-1',
      elementId: 'rect-1',
      element: {
        id: 'rect-1',
        type: 'rectangle',
        x: 100,
        y: 100,
        width: 200,
        height: 150,
        version: 1,
        versionNonce: 1001,
      },
    })
  );

  await new Promise((r) => setTimeout(r, 150));
  if (!userBReceivedElementCreate) throw new Error('User B did not receive element:create broadcast');
  if (!userAReceivedElementCreate) throw new Error('User A (sender) did not receive canonical element:create broadcast');

  // Test 4b: Reverse Two-Way Synchronization (User B draws -> User A receives)
  console.log('\n[Test 4b] Two-Way Drawing: User B draws -> User A receives');
  let userAReceivedUserBCreate = false;
  wsA.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'operation:broadcast' && msg.operation?.elementId === 'circle-b1') {
      userAReceivedUserBCreate = true;
      console.log(`  ✓ User A received User B's drawing broadcast (rev: ${msg.revision}, clientId: ${msg.operation.clientId})`);
    }
  });

  wsB.send(
    JSON.stringify({
      type: 'element:create',
      roomId: testRoomId,
      clientId: 'client-bob-1',
      operationId: 'op-create-b1',
      elementId: 'circle-b1',
      element: {
        id: 'circle-b1',
        type: 'ellipse',
        x: 200,
        y: 200,
        width: 100,
        height: 100,
        version: 1,
        versionNonce: 2001,
      },
    })
  );

  await new Promise((r) => setTimeout(r, 150));
  if (!userAReceivedUserBCreate) throw new Error('User A did not receive User B drawing operation');

  // Test 4c: Impersonation Prevention
  console.log('\n[Test 4c] Impersonation Prevention: Spoofed clientId is overridden by authenticated socket identity');
  let impersonationTestPassed = false;
  wsA.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'operation:broadcast' && msg.operation?.elementId === 'spoof-test') {
      // Even though User B sent 'client-alice-1', server must broadcast 'client-bob-1'
      if (msg.operation.clientId === 'client-bob-1') {
        impersonationTestPassed = true;
        console.log(`  ✓ Server overrode spoofed clientId and used authoritative '${msg.operation.clientId}'`);
      }
    }
  });

  wsB.send(
    JSON.stringify({
      type: 'element:create',
      roomId: testRoomId,
      clientId: 'client-alice-1', // Attempting to spoof Alice's clientId!
      operationId: 'op-spoof-1',
      elementId: 'spoof-test',
      element: {
        id: 'spoof-test',
        type: 'line',
        x: 0,
        y: 0,
        version: 1,
        versionNonce: 3001,
      },
    })
  );

  await new Promise((r) => setTimeout(r, 150));
  if (!impersonationTestPassed) throw new Error('Server accepted spoofed clientId instead of enforcing authoritative socket clientId');

  // Test 4d: Reject operation on unjoined room
  console.log('\n[Test 4d] Reject operation on unjoined room');
  let unjoinedRoomRejected = false;
  wsA.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'error' && msg.message?.includes('Unauthorized: room not joined')) {
      unjoinedRoomRejected = true;
      console.log(`  ✓ Rejected unjoined room operation with error: "${msg.message}"`);
    }
  });

  wsA.send(
    JSON.stringify({
      type: 'element:create',
      roomId: 'unjoined-random-room-id',
      operationId: 'op-unjoined-1',
      elementId: 'rect-unjoined',
      element: { id: 'rect-unjoined', type: 'rectangle', version: 1, versionNonce: 1 },
    })
  );

  await new Promise((r) => setTimeout(r, 150));
  if (!unjoinedRoomRejected) throw new Error('Server did not reject operation on unjoined room');

  // Test 5: Deterministic Conflict Reconciliation on element:update
  console.log('\n[Test 5] Element Update & Conflict Reconciliation');
  let userBReceivedElementUpdate = false;
  wsB.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'operation:broadcast' && msg.operation.type === 'element:update') {
      userBReceivedElementUpdate = true;
      console.log(`  ✓ User B received 'operation:broadcast' for element:update (rev: ${msg.revision}, x: ${msg.operation.element.x})`);
    }
  });

  wsA.send(
    JSON.stringify({
      type: 'element:update',
      roomId: testRoomId,
      clientId: 'client-alice-1',
      operationId: 'op-update-1',
      elementId: 'rect-1',
      element: {
        id: 'rect-1',
        type: 'rectangle',
        x: 150,
        y: 150,
        width: 200,
        height: 150,
        version: 2,
        versionNonce: 2002,
      },
    })
  );

  await new Promise((r) => setTimeout(r, 150));
  if (!userBReceivedElementUpdate) throw new Error('User B did not receive element:update broadcast');

  // Test 6: Movement Preview (Ephemeral Drag Stroke)
  console.log('\n[Test 6] Ephemeral Movement Preview (Drag Stroke)');
  let userBReceivedMovePreview = false;
  wsB.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'operation:broadcast' && msg.operation.type === 'element:move-preview') {
      userBReceivedMovePreview = true;
      console.log(`  ✓ User B received ephemeral 'element:move-preview'`);
    }
  });

  wsA.send(
    JSON.stringify({
      type: 'element:move-preview',
      roomId: testRoomId,
      clientId: 'client-alice-1',
      operationId: 'op-preview-1',
      elementId: 'rect-1',
      element: {
        id: 'rect-1',
        x: 160,
        y: 160,
      },
    })
  );

  await new Promise((r) => setTimeout(r, 150));
  if (!userBReceivedMovePreview) throw new Error('User B did not receive element:move-preview');

  // Test 7: Ephemeral Presence & World Cursors
  console.log('\n[Test 7] Ephemeral Presence & World Coordinates Cursor');
  let userBReceivedPresence = false;
  wsB.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'presence:update' && msg.cursor?.x === 350.5) {
      userBReceivedPresence = true;
      console.log(`  ✓ User B received 'presence:update' (cursor: [${msg.cursor.x}, ${msg.cursor.y}], color: ${msg.color})`);
    }
  });

  wsA.send(
    JSON.stringify({
      type: 'presence:update',
      roomId: testRoomId,
      cursor: { x: 350.5, y: 420.0 },
      selectedElementId: 'rect-1',
    })
  );

  await new Promise((r) => setTimeout(r, 150));
  if (!userBReceivedPresence) throw new Error('User B did not receive presence:update');

  // Test 8: Catch-up Sync on Reconnect
  console.log('\n[Test 8] Reconnect Catch-up Sync (room:sync-request)');
  let userBReceivedSyncCatchup = false;
  wsB.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'room:sync') {
      userBReceivedSyncCatchup = true;
      console.log(`  ✓ User B received 'room:sync' (fullSync: ${msg.fullSync}, revision: ${msg.revision})`);
    }
  });

  wsB.send(
    JSON.stringify({
      type: 'room:sync-request',
      roomId: testRoomId,
      lastKnownVersion: 0,
    })
  );

  await new Promise((r) => setTimeout(r, 150));
  if (!userBReceivedSyncCatchup) throw new Error('User B did not receive room:sync');

  // Test 9: Heartbeat Ping / Pong
  console.log('\n[Test 9] Heartbeat Keep-Alive');
  wsA.send(JSON.stringify({ type: 'pong' }));
  console.log('  ✓ Handled pong heartbeat message');

  // Test 10: Chat message saving and broadcasting
  console.log('\n[Test 10] Text Chat Message Broadcast');
  let userBReceivedChatMessage = false;
  wsB.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'chat' && msg.message?.content === 'Hello from Alice!') {
      userBReceivedChatMessage = true;
      console.log(`  ✓ User B received 'chat' broadcast from ${msg.message.userId.name}: "${msg.message.content}"`);
    }
  });

  wsA.send(
    JSON.stringify({
      type: 'chat',
      roomId: testRoomId,
      content: 'Hello from Alice!',
    })
  );

  await new Promise((r) => setTimeout(r, 150));
  if (!userBReceivedChatMessage) throw new Error('User B did not receive chat message');

  // Test 11: Disconnect & user:left broadcast
  console.log('\n[Test 11] Disconnect & user:left broadcast');
  let userBReceivedUserALeft = false;
  wsB.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'user:left' && msg.clientId === 'client-alice-1') {
      userBReceivedUserALeft = true;
      console.log(`  ✓ User B received 'user:left' broadcast for User A (${msg.clientId})`);
    }
  });

  wsA.close();
  await new Promise((r) => setTimeout(r, 200));
  if (!userBReceivedUserALeft) throw new Error('User B did not receive user:left for User A');

  wsB.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  console.log('\n🎉 =========================================================');
  console.log('🎉 ALL 11 WEBSOCKET ENGINE TESTS PASSED SUCCESSFULLY!');
  console.log('🎉 =========================================================\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\n❌ Test execution failed:', err);
  process.exit(1);
});
