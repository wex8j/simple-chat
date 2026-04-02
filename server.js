const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));

// قاعدة البيانات المركزية
const users = {};
let posts = [];

// منشور ترحيبي
posts.push({
    id: Date.now(),
    username: 'baghdad',
    displayName: 'دردشة بغداد لايف',
    text: '✨ هلا بيكم في دردشة بغداد لايف ✨',
    time: new Date().toISOString(),
    likes: 0
});

io.on('connection', (socket) => {
    console.log('✅ مستخدم جديد:', socket.id);
    let currentUser = null;

    socket.on('login', (data) => {
        const { username, password, displayName } = data;
        
        if (!users[username]) {
            users[username] = {
                password: password,
                displayName: displayName || username,
                friends: [],
                requests: [],
                socketId: socket.id
            };
            console.log(`📝 مستخدم جديد: ${username}`);
        } else if (users[username].password !== password) {
            socket.emit('login-error', 'كلمة السر غير صحيحة');
            return;
        } else {
            users[username].socketId = socket.id;
        }
        
        currentUser = username;
        
        socket.emit('login-success', {
            username: username,
            displayName: users[username].displayName,
            friends: users[username].friends,
            requests: users[username].requests,
            posts: posts,
            users: Object.keys(users).map(u => ({
                username: u,
                displayName: users[u].displayName
            }))
        });
        
        socket.broadcast.emit('user-online', { username });
    });
    
    // إضافة صديق
    socket.on('add-friend', (toUsername) => {
        if (!currentUser) return;
        const target = users[toUsername];
        if (!target) return;
        if (users[currentUser].friends.includes(toUsername)) return;
        
        if (!target.requests.includes(currentUser)) {
            target.requests.push(currentUser);
            io.to(target.socketId).emit('new-request', {
                from: currentUser,
                fromName: users[currentUser].displayName
            });
        }
    });
    
    // قبول صديق
    socket.on('accept-friend', (fromUsername) => {
        if (!currentUser) return;
        const current = users[currentUser];
        const from = users[fromUsername];
        
        current.requests = current.requests.filter(u => u !== fromUsername);
        if (!current.friends.includes(fromUsername)) current.friends.push(fromUsername);
        if (!from.friends.includes(currentUser)) from.friends.push(currentUser);
        
        io.to(current.socketId).emit('request-accepted', { from: fromUsername, fromName: from.displayName });
        io.to(from.socketId).emit('request-accepted', { from: currentUser, fromName: current.displayName });
    });
    
    // رفض صديق
    socket.on('reject-friend', (fromUsername) => {
        if (!currentUser) return;
        users[currentUser].requests = users[currentUser].requests.filter(u => u !== fromUsername);
    });
    
    // رسالة خاصة
    socket.on('private-message', (data) => {
        if (!currentUser) return;
        const { to, message } = data;
        const target = users[to];
        if (target && users[currentUser].friends.includes(to)) {
            io.to(target.socketId).emit('new-message', {
                from: currentUser,
                fromName: users[currentUser].displayName,
                message: message,
                time: new Date().toLocaleTimeString('ar-EG')
            });
        }
    });
    
    // منشور جديد
    socket.on('new-post', (data) => {
        if (!currentUser) return;
        posts.unshift({
            id: Date.now(),
            username: currentUser,
            displayName: users[currentUser].displayName,
            text: data.text,
            time: new Date().toISOString(),
            likes: 0
        });
        io.emit('post-added', posts[0]);
    });
    
    // إعجاب
    socket.on('like-post', (id) => {
        let post = posts.find(p => p.id == id);
        if (post) { post.likes++; io.emit('post-updated', post); }
    });
    
    // حذف منشور
    socket.on('delete-post', (id) => {
        let index = posts.findIndex(p => p.id == id);
        if (index !== -1 && posts[index].username === currentUser) {
            posts.splice(index, 1);
            io.emit('post-deleted', id);
        }
    });
    
    socket.on('disconnect', () => {
        if (currentUser && users[currentUser]) {
            console.log(`👋 مستخدم غادر: ${currentUser}`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 دردشة بغداد لايف شغالة`);
});
