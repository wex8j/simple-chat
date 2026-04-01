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

// تخزين البيانات
const users = {};
let posts = [];
let friendRequests = [];
let blockedUsers = [];

// منشورات تجريبية
posts.push({
    id: Date.now(),
    username: '3tx',
    displayName: 'أبو علي',
    text: 'مرحباً بالجميع في بغداد لايف! 🎉 تواصل مع الناس وشارك منشوراتك',
    image: null,
    time: new Date().toISOString(),
    likes: 5
});

io.on('connection', (socket) => {
    console.log('مستخدم جديد:', socket.id);
    let currentUser = null;
    
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
            users: Object.keys(users).map(u => ({ 
                username: u, 
                displayName: users[u].displayName, 
                online: users[u].online 
            }))
        });
        
        socket.broadcast.emit('user-online', { username, displayName });
    });
    
    socket.on('new-post', (data) => {
        if (!currentUser) return;
        
        const newPost = {
            id: Date.now(),
            username: currentUser,
            displayName: users[currentUser].displayName,
            text: data.text,
            image: data.image,
            time: new Date().toISOString(),
            likes: 0
        };
        
        posts.unshift(newPost);
        io.emit('post-added', newPost);
    });
    
    socket.on('like-post', (postId) => {
        const post = posts.find(p => p.id == postId);
        if (post) {
            post.likes++;
            io.emit('post-updated', post);
        }
    });
    
    socket.on('delete-post', (postId) => {
        const index = posts.findIndex(p => p.id == postId);
        if (index !== -1 && posts[index].username === currentUser) {
            posts.splice(index, 1);
            io.emit('post-deleted', postId);
        }
    });
    
    socket.on('send-request', (toUsername) => {
        if (!currentUser) return;
        
        if (blockedUsers.some(b => (b.blocker === currentUser && b.blocked === toUsername))) {
            socket.emit('request-error', 'لا يمكنك إرسال طلب لهذا المستخدم');
            return;
        }
        
        const existing = friendRequests.find(r => 
            (r.from === currentUser && r.to === toUsername) ||
            (r.from === toUsername && r.to === currentUser)
        );
        
        if (!existing) {
            friendRequests.push({ from: currentUser, to: toUsername, status: 'pending' });
            const targetSocket = users[toUsername]?.socketId;
            if (targetSocket) {
                io.to(targetSocket).emit('new-request', { 
                    from: currentUser, 
                    fromName: users[currentUser].displayName 
                });
            }
        }
    });
    
    socket.on('accept-request', (fromUsername) => {
        if (!currentUser) return;
        
        const request = friendRequests.find(r => 
            r.from === fromUsername && r.to === currentUser && r.status === 'pending'
        );
        
        if (request) {
            request.status = 'accepted';
            
            const fromSocket = users[fromUsername]?.socketId;
            if (fromSocket) {
                io.to(fromSocket).emit('request-accepted', { 
                    with: currentUser, 
                    withName: users[currentUser].displayName 
                });
            }
            socket.emit('request-accepted', { 
                with: fromUsername, 
                withName: users[fromUsername].displayName 
            });
        }
    });
    
    socket.on('reject-request', (fromUsername) => {
        const index = friendRequests.findIndex(r => 
            r.from === fromUsername && r.to === currentUser && r.status === 'pending'
        );
        if (index !== -1) friendRequests.splice(index, 1);
    });
    
    socket.on('send-chat-message', (data) => {
        if (!currentUser) return;
        
        const { roomId, message } = data;
        const usersInRoom = roomId.split('-');
        
        if (!usersInRoom.includes(currentUser)) return;
        
        const otherUser = usersInRoom.find(u => u !== currentUser);
        const targetSocket = users[otherUser]?.socketId;
        
        if (targetSocket) {
            io.to(targetSocket).emit('chat-message', {
                from: currentUser,
                fromName: users[currentUser].displayName,
                message: message,
                time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
            });
        }
    });
    
    socket.on('block-user', (blockedUsername) => {
        if (!currentUser) return;
        
        if (!blockedUsers.some(b => b.blocker === currentUser && b.blocked === blockedUsername)) {
            blockedUsers.push({ blocker: currentUser, blocked: blockedUsername });
            
            // حذف الطلبات بينهم
            const reqIndex = friendRequests.findIndex(r => 
                (r.from === currentUser && r.to === blockedUsername) ||
                (r.from === blockedUsername && r.to === currentUser)
            );
            if (reqIndex !== -1) friendRequests.splice(reqIndex, 1);
        }
    });
    
    socket.on('unblock-user', (unblockedUsername) => {
        if (!currentUser) return;
        
        const index = blockedUsers.findIndex(b => 
            b.blocker === currentUser && b.blocked === unblockedUsername
        );
        if (index !== -1) blockedUsers.splice(index, 1);
    });
    
    socket.on('disconnect', () => {
        if (currentUser && users[currentUser]) {
            users[currentUser].online = false;
            io.emit('user-offline', { username: currentUser });
            delete users[currentUser];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ السيرفر شغال على http://localhost:${PORT}`);
    console.log(`🎉 تطبيق اجتماعي متكامل - منشورات + محادثات`);
});
