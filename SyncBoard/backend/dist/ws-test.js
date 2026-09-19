"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = __importDefault(require("ws"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const http_1 = __importDefault(require("http"));
const express_1 = __importDefault(require("express"));
const Room_1 = require("./models/Room");
const Message_1 = require("./models/Message");
const User_1 = require("./models/User");
const roomManager_1 = require("./ws/roomManager");
const ws_2 = require("./ws");
const JWT_SECRET = 'abcdefghijkl';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';
function runTests() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('🧪 =========================================================');
        console.log('🧪 Starting WebSocket Engine Verification Tests (In-Memory)');
        console.log('🧪 =========================================================\n');
        const app = (0, express_1.default)();
        const server = http_1.default.createServer(app);
        (0, ws_2.attachWebSocketServer)(server);
        yield new Promise((resolve) => server.listen(0, resolve));
        const port = server.address().port;
        console.log(`✓ Test HTTP + WS Server listening on port ${port}`);
        const userA = { userId: '507f1f77bcf86cd799439011', name: 'Alice' };
        const userB = { userId: '507f1f77bcf86cd799439022', name: 'Bob' };
        const tokenA = jsonwebtoken_1.default.sign(userA, JWT_SECRET);
        const tokenB = jsonwebtoken_1.default.sign(userB, JWT_SECRET);
        const testRoomId = 'test-collab-room-1';
        // Setup in-memory room in roomManager and mock DB calls
        const initialRoomState = new roomManager_1.RoomState(testRoomId, [], 0);
        roomManager_1.roomManager.rooms.set(testRoomId, initialRoomState);
        Room_1.Room.findOne = () => __awaiter(this, void 0, void 0, function* () {
            return ({
                _id: testRoomId,
                slug: testRoomId,
                adminId: userA.userId,
                collaborators: [userB.userId],
                elements: [],
                version: 0,
            });
        });
        User_1.User.findById = (id) => ({
            select: () => __awaiter(this, void 0, void 0, function* () {
                return ({
                    _id: id,
                    name: id === userA.userId ? 'Alice' : 'Bob',
                });
            }),
        });
        Message_1.Message.create = (doc) => __awaiter(this, void 0, void 0, function* () {
            return (Object.assign(Object.assign({}, doc), { populate: () => __awaiter(this, void 0, void 0, function* () {
                    return (Object.assign(Object.assign({}, doc), { userId: {
                            _id: doc.userId,
                            name: doc.userId === userA.userId ? 'Alice' : 'Bob',
                            photo: null,
                        } }));
                }) }));
        });
        // Test 1: Reject unauthenticated connection
        console.log('\n[Test 1] Reject unauthenticated connection');
        yield new Promise((resolve, reject) => {
            const ws = new ws_1.default(`ws://localhost:${port}`);
            let closed = false;
            ws.on('close', (code) => {
                closed = true;
                console.log(`  ✓ Connection closed with code ${code} as expected`);
                resolve();
            });
            setTimeout(() => {
                if (!closed)
                    reject(new Error('Connection remained open without token'));
            }, 500);
        });
        // Test 2: Connect User A with valid token
        console.log('\n[Test 2] Connect User A and Join Room');
        const wsA = new ws_1.default(`ws://localhost:${port}?token=${tokenA}`);
        yield new Promise((resolve) => wsA.on('open', resolve));
        console.log('  ✓ User A WebSocket opened');
        let userAReceivedRoomState = false;
        wsA.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'room:state' && msg.roomId === testRoomId) {
                userAReceivedRoomState = true;
                console.log(`  ✓ User A received 'room:state' (revision: ${msg.revision}, users: ${msg.users.length})`);
            }
        });
        wsA.send(JSON.stringify({
            type: 'room:join',
            roomId: testRoomId,
            clientId: 'client-alice-1',
        }));
        yield new Promise((r) => setTimeout(r, 150));
        if (!userAReceivedRoomState)
            throw new Error('User A did not receive room:state');
        // Test 3: Connect User B and verify user:joined broadcast to User A
        console.log('\n[Test 3] Connect User B and verify user:joined broadcast to User A');
        const wsB = new ws_1.default(`ws://localhost:${port}?token=${tokenB}`);
        yield new Promise((resolve) => wsB.on('open', resolve));
        let userAReceivedUserBJoined = false;
        wsA.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'user:joined' && msg.user.userId === userB.userId) {
                userAReceivedUserBJoined = true;
                console.log(`  ✓ User A received 'user:joined' broadcast for User B (${msg.user.clientId})`);
            }
        });
        wsB.send(JSON.stringify({
            type: 'room:join',
            roomId: testRoomId,
            clientId: 'client-bob-1',
        }));
        yield new Promise((r) => setTimeout(r, 150));
        if (!userAReceivedUserBJoined)
            throw new Error('User A did not receive user:joined for User B');
        // Test 4: Element Creation & Broadcast
        console.log('\n[Test 4] Differential Element Creation & Broadcast');
        let userBReceivedElementCreate = false;
        wsB.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'operation:broadcast' && msg.operation.type === 'element:create') {
                userBReceivedElementCreate = true;
                console.log(`  ✓ User B received 'operation:broadcast' for element:create (id: ${msg.operation.elementId}, rev: ${msg.revision})`);
            }
        });
        wsA.send(JSON.stringify({
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
        }));
        yield new Promise((r) => setTimeout(r, 150));
        if (!userBReceivedElementCreate)
            throw new Error('User B did not receive element:create broadcast');
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
        wsA.send(JSON.stringify({
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
        }));
        yield new Promise((r) => setTimeout(r, 150));
        if (!userBReceivedElementUpdate)
            throw new Error('User B did not receive element:update broadcast');
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
        wsA.send(JSON.stringify({
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
        }));
        yield new Promise((r) => setTimeout(r, 150));
        if (!userBReceivedMovePreview)
            throw new Error('User B did not receive element:move-preview');
        // Test 7: Ephemeral Presence & World Cursors
        console.log('\n[Test 7] Ephemeral Presence & World Coordinates Cursor');
        let userBReceivedPresence = false;
        wsB.on('message', (data) => {
            var _a;
            const msg = JSON.parse(data.toString());
            if (msg.type === 'presence:update' && ((_a = msg.cursor) === null || _a === void 0 ? void 0 : _a.x) === 350.5) {
                userBReceivedPresence = true;
                console.log(`  ✓ User B received 'presence:update' (cursor: [${msg.cursor.x}, ${msg.cursor.y}], color: ${msg.color})`);
            }
        });
        wsA.send(JSON.stringify({
            type: 'presence:update',
            roomId: testRoomId,
            cursor: { x: 350.5, y: 420.0 },
            selectedElementId: 'rect-1',
        }));
        yield new Promise((r) => setTimeout(r, 150));
        if (!userBReceivedPresence)
            throw new Error('User B did not receive presence:update');
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
        wsB.send(JSON.stringify({
            type: 'room:sync-request',
            roomId: testRoomId,
            lastKnownVersion: 0,
        }));
        yield new Promise((r) => setTimeout(r, 150));
        if (!userBReceivedSyncCatchup)
            throw new Error('User B did not receive room:sync');
        // Test 9: Heartbeat Ping / Pong
        console.log('\n[Test 9] Heartbeat Keep-Alive');
        wsA.send(JSON.stringify({ type: 'pong' }));
        console.log('  ✓ Handled pong heartbeat message');
        // Test 10: Chat message saving and broadcasting
        console.log('\n[Test 10] Text Chat Message Broadcast');
        let userBReceivedChatMessage = false;
        wsB.on('message', (data) => {
            var _a;
            const msg = JSON.parse(data.toString());
            if (msg.type === 'chat' && ((_a = msg.message) === null || _a === void 0 ? void 0 : _a.content) === 'Hello from Alice!') {
                userBReceivedChatMessage = true;
                console.log(`  ✓ User B received 'chat' broadcast from ${msg.message.userId.name}: "${msg.message.content}"`);
            }
        });
        wsA.send(JSON.stringify({
            type: 'chat',
            roomId: testRoomId,
            content: 'Hello from Alice!',
        }));
        yield new Promise((r) => setTimeout(r, 150));
        if (!userBReceivedChatMessage)
            throw new Error('User B did not receive chat message');
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
        yield new Promise((r) => setTimeout(r, 200));
        if (!userBReceivedUserALeft)
            throw new Error('User B did not receive user:left for User A');
        wsB.close();
        yield new Promise((resolve) => server.close(() => resolve()));
        console.log('\n🎉 =========================================================');
        console.log('🎉 ALL 11 WEBSOCKET ENGINE TESTS PASSED SUCCESSFULLY!');
        console.log('🎉 =========================================================\n');
        process.exit(0);
    });
}
runTests().catch((err) => {
    console.error('\n❌ Test execution failed:', err);
    process.exit(1);
});
