const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// تخزين بيانات المستخدمين
const users = {}; // { username: { socketId, displayName, isAdmin } }
const socketToUser = {}; // { socketId: username }
const mutedUsers = []; // قائمة المكتمين
const bannedUsers = []; // قائمة المحظورين

io.on('connection', (socket) => {
    console.log('مستخدم جديد:', socket.id);

    // تسجيل الدخول
    socket.on('set-user', (userData) => {
        const { username, displayName, isAdmin } = userData;
        
        // التحقق من الحظر
        if (bannedUsers.includes(username)) {
            socket.emit('banned', { username, displayName });
            return;
        }
        
        // التحقق إذا اليوزر نيم مستخدم
        if (users[username]) {
            socket.emit('username-taken');
            return;
        }
        
        // حفظ المستخدم
        users[username] = {
            socketId: socket.id,
            displayName: displayName,
            isAdmin: isAdmin || false
        };
        socketToUser[socket.id] = username;
        
        // إرسال قائمة المستخدمين
        const userList = Object.keys(users).map(u => ({
            username: u,
            displayName: users[u].displayName,
            isAdmin: users[u].isAdmin
        }));
        io.emit('users-list', userList);
        
        // إعلان دخول المستخدم
        io.emit('user-joined', {
            username: username,
            displayName: displayName,
            isAdmin: isAdmin || false
        });
    });

    // استقبال رسالة
    socket.on('send-message', (data) => {
        const { username, displayName, message, isAdmin } = data;
        
        // التحقق من الكتم
        if (mutedUsers.includes(username)) {
            socket.emit('mute-update', { username, muted: true });
            return;
        }
        
        io.emit('receive-message', {
            username: username,
            displayName: displayName,
            message: message,
            isAdmin: isAdmin || false,
            time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
        });
    });

    // طرد مستخدم (فقط المشرف)
    socket.on('kick-user', (data) => {
        const adminUsername = socketToUser[socket.id];
        if (!adminUsername || !users[adminUsername]?.isAdmin) return;
        
        const { username, displayName } = data;
        const userSocketId = users[username]?.socketId;
        
        if (userSocketId) {
            io.to(userSocketId).emit('kicked', { username, displayName });
            // إغلاق اتصال المستخدم
            const clientSocket = io.sockets.sockets.get(userSocketId);
            if (clientSocket) clientSocket.disconnect();
        }
    });

    // حظر مستخدم (فقط المشرف)
    socket.on('ban-user', (data) => {
        const adminUsername = socketToUser[socket.id];
        if (!adminUsername || !users[adminUsername]?.isAdmin) return;
        
        const { username, displayName } = data;
        if (!bannedUsers.includes(username)) {
            bannedUsers.push(username);
        }
        
        const userSocketId = users[username]?.socketId;
        if (userSocketId) {
            io.to(userSocketId).emit('banned', { username, displayName });
            const clientSocket = io.sockets.sockets.get(userSocketId);
            if (clientSocket) clientSocket.disconnect();
        }
        
        // إزالة المستخدم من قائمة المتصلين
        if (users[username]) {
            delete users[username];
            delete socketToUser[userSocketId];
        }
        
        // تحديث قائمة المستخدمين للجميع
        const userList = Object.keys(users).map(u => ({
            username: u,
            displayName: users[u].displayName,
            isAdmin: users[u].isAdmin
        }));
        io.emit('users-list', userList);
        io.emit('user-left', { username, displayName });
    });

    // كتم/فك كتم مستخدم (فقط المشرف)
    socket.on('mute-user', (data) => {
        const adminUsername = socketToUser[socket.id];
        if (!adminUsername || !users[adminUsername]?.isAdmin) return;
        
        const { username, muted } = data;
        
        if (muted) {
            if (!mutedUsers.includes(username)) {
                mutedUsers.push(username);
            }
        } else {
            const index = mutedUsers.indexOf(username);
            if (index !== -1) mutedUsers.splice(index, 1);
        }
        
        // إعلام المستخدم المكتم
        const userSocketId = users[username]?.socketId;
        if (userSocketId) {
            io.to(userSocketId).emit('mute-update', { username, muted });
        }
    });

    // قطع الاتصال
    socket.on('disconnect', () => {
        const username = socketToUser[socket.id];
        if (username && users[username]) {
            const userData = users[username];
            delete users[username];
            delete socketToUser[socket.id];
            
            const userList = Object.keys(users).map(u => ({
                username: u,
                displayName: users[u].displayName,
                isAdmin: users[u].isAdmin
            }));
            io.emit('users-list', userList);
            io.emit('user-left', {
                username: username,
                displayName: userData.displayName,
                isAdmin: userData.isAdmin
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ السيرفر شغال على http://localhost:${PORT}`);
    console.log(`👑 المشرف: 3tx`);
});
