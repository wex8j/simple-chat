const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

// تخزين البيانات
const users = {}; // { username: { displayName, socketId, online } }
const posts = []; // { id, username, displayName, text, image, time, likes, comments }
const friendRequests = []; // { from, to, status }
const blockedUsers = []; // { blocker, blocked }
const conversations = {}; // { roomId: [messages] }

// تحميل منشورات تجريبية
posts.push({
    id: 1,
    username: '3tx',
    displayName: 'أبو علي',
    text: 'مرحباً بالجميع في دردشة بغداد لايف! 🎉',
    image: null,
    time: new Date().toISOString(),
    likes: 5,
    comments: []
});

io.on('connection', (socket) => {
    console.log('مستخدم جديد:', socket.id);
    
    let currentUser = null;
    
    // تسجيل الدخول
    socket.on('login', (data) => {
        const { username, displayName } = data;
        
        if (users[username]) {
            socket.emit('login-error', 'هذا اليوزر نيم مستخدم من قبل');
            return;
        }
        
        currentUser = username;
        users[username] = {
            displayName: displayName,
            socketId: socket.id,
            online: true
        };
        
        socket.emit('login-success', {
            username,
            displayName,
            posts: posts.slice(0, 50),
            users: Object.keys(users).map(u => ({ username: u, displayName: users[u].displayName, online: users[u].online }))
        });
        
        // إعلام الجميع بالمستخدم الجديد
        io.emit('user-online', { username, displayName });
    });
    
    // نشر منشور
    socket.on('new-post', (data) => {
        if (!currentUser) return;
        
        const newPost = {
            id: Date.now(),
            username: currentUser,
            displayName: users[currentUser].displayName,
            text: data.text || '',
            image: data.image || null,
            time: new Date().toISOString(),
            likes: 0,
            comments: []
        };
        
        posts.unshift(newPost);
        io.emit('post-added', newPost);
    });
    
    // إعجاب بمنشور
    socket.on('like-post', (postId) => {
        const post = posts.find(p => p.id == postId);
        if (post) {
            post.likes++;
            io.emit('post-updated', post);
        }
    });
    
    // حذف منشور
    socket.on('delete-post', (postId) => {
        const postIndex = posts.findIndex(p => p.id == postId);
        if (postIndex !== -1 && posts[postIndex].username === currentUser) {
            posts.splice(postIndex, 1);
            io.emit('post-deleted', postId);
        }
    });
    
    // إرسال طلب محادثة
    socket.on('send-request', (toUsername) => {
        if (!currentUser) return;
        
        // التحقق من الحظر
        const isBlocked = blockedUsers.some(b => 
            (b.blocker === currentUser && b.blocked === toUsername) ||
            (b.blocker === toUsername && b.blocked === currentUser)
        );
        
        if (isBlocked) {
            socket.emit('request-error', 'لا يمكنك إرسال طلب لهذا المستخدم');
            return;
        }
        
        const existingRequest = friendRequests.find(r => 
            (r.from === currentUser && r.to === toUsername) ||
            (r.from === toUsername && r.to === currentUser)
        );
        
        if (existingRequest) {
            socket.emit('request-error', 'يوجد طلب مسبق');
            return;
        }
        
        friendRequests.push({
            from: currentUser,
            to: toUsername,
            status: 'pending',
            time: new Date().toISOString()
        });
        
        const targetSocketId = users[toUsername]?.socketId;
        if (targetSocketId) {
            io.to(targetSocketId).emit('new-request', {
                from: currentUser,
                fromName: users[currentUser].displayName
            });
        }
        
        socket.emit('request-sent', { to: toUsername });
    });
    
    // قبول طلب محادثة
    socket.on('accept-request', (fromUsername) => {
        if (!currentUser) return;
        
        const request = friendRequests.find(r => 
            r.from === fromUsername && r.to === currentUser && r.status === 'pending'
        );
        
        if (request) {
            request.status = 'accepted';
            
            const roomId = [fromUsername, currentUser].sort().join('-');
            conversations[roomId] = conversations[roomId] || [];
            
            const fromSocket = users[fromUsername]?.socketId;
            const toSocket = users[currentUser]?.socketId;
            
            io.to(fromSocket).emit('request-accepted', {
                with: currentUser,
                withName: users[currentUser].displayName,
                roomId
            });
            
            socket.emit('request-accepted', {
                with: fromUsername,
                withName: users[fromUsername].displayName,
                roomId
            });
        }
    });
    
    // رفض طلب محادثة
    socket.on('reject-request', (fromUsername) => {
        if (!currentUser) return;
        
        const index = friendRequests.findIndex(r => 
            r.from === fromUsername && r.to === currentUser && r.status === 'pending'
        );
        
        if (index !== -1) {
            friendRequests.splice(index, 1);
            const fromSocket = users[fromUsername]?.socketId;
            if (fromSocket) {
                io.to(fromSocket).emit('request-rejected', { by: currentUser });
            }
        }
    });
    
    // إرسال رسالة في الدردشة
    socket.on('send-chat-message', (data) => {
        if (!currentUser) return;
        
        const { roomId, message } = data;
        const roomUsers = roomId.split('-');
        
        if (!roomUsers.includes(currentUser)) return;
        
        const messageData = {
            from: currentUser,
            fromName: users[currentUser].displayName,
            message: message,
            time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
        };
        
        conversations[roomId] = conversations[roomId] || [];
        conversations[roomId].push(messageData);
        
        const otherUser = roomUsers.find(u => u !== currentUser);
        const otherSocket = users[otherUser]?.socketId;
        
        if (otherSocket) {
            io.to(otherSocket).emit('chat-message', messageData);
        }
        socket.emit('chat-message', messageData);
    });
    
    // حظر مستخدم
    socket.on('block-user', (blockedUsername) => {
        if (!currentUser) return;
        
        if (!blockedUsers.some(b => b.blocker === currentUser && b.blocked === blockedUsername)) {
            blockedUsers.push({ blocker: currentUser, blocked: blockedUsername });
            
            // حذف أي طلبات بينهم
            const requestIndex = friendRequests.findIndex(r => 
                (r.from === currentUser && r.to === blockedUsername) ||
                (r.from === blockedUsername && r.to === currentUser)
            );
            if (requestIndex !== -1) friendRequests.splice(requestIndex, 1);
            
            socket.emit('user-blocked', { blocked: blockedUsername });
        }
    });
    
    // إزالة حظر
    socket.on('unblock-user', (unblockedUsername) => {
        if (!currentUser) return;
        
        const index = blockedUsers.findIndex(b => 
            b.blocker === currentUser && b.blocked === unblockedUsername
        );
        if (index !== -1) blockedUsers.splice(index, 1);
        
        socket.emit('user-unblocked', { unblocked: unblockedUsername });
    });
    
    // قطع الاتصال
    socket.on('disconnect', () => {
        if (currentUser && users[currentUser]) {
            users[currentUser].online = false;
            io.emit('user-offline', { username: currentUser });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ السيرفر شغال على http://localhost:${PORT}`);
    console.log(`🎉 تطبيق اجتماعي متكامل - منشورات + دردشة`);
});
