const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

// تخزين البيانات
const users = {};
let posts = [];

// منشور تجريبي
posts.push({
    id: Date.now(),
    username: '3tx',
    displayName: 'أبو علي',
    text: 'مرحباً بالجميع في بغداد لايف! 🎉 تواصل مع الناس وشارك منشوراتك',
    time: new Date().toISOString(),
    likes: 5
});

io.on('connection', (socket) => {
    console.log('✅ مستخدم جديد:', socket.id);
    let currentUser = null;
    
    socket.on('login', (data) => {
        const { username, password, displayName } = data;
        
        // تسجيل مستخدم جديد
        if (!users[username]) {
            users[username] = {
                password: password,
                displayName: displayName || username,
                friends: [],
                pendingRequests: [],
                socketId: socket.id
            };
            console.log(`📝 مستخدم جديد: ${username}`);
        }
        // التحقق من كلمة السر
        else if (users[username].password !== password) {
            socket.emit('login-error', 'كلمة السر غير صحيحة');
            return;
        } else {
            users[username].socketId = socket.id;
        }
        
        currentUser = username;
        
        // إرسال بيانات المستخدم
        socket.emit('login-success', {
            username: username,
            displayName: users[username].displayName,
            friends: users[username].friends,
            pendingRequests: users[username].pendingRequests,
            posts: posts,
            users: Object.keys(users).map(u => ({
                username: u,
                displayName: users[u].displayName
            }))
        });
        
        // إعلان للمستخدمين الآخرين
        socket.broadcast.emit('user-online', { username, displayName: users[username].displayName });
    });
    
    // طلب صداقة
    socket.on('send-friend-request', (toUsername) => {
        if (!currentUser) return;
        if (!users[toUsername]) return;
        if (users[currentUser].friends.includes(toUsername)) return;
        
        const targetUser = users[toUsername];
        if (!targetUser.pendingRequests.includes(currentUser)) {
            targetUser.pendingRequests.push(currentUser);
            
            io.to(targetUser.socketId).emit('new-friend-request', {
                from: currentUser,
                fromName: users[currentUser].displayName
            });
            
            socket.emit('request-sent', { to: toUsername });
        }
    });
    
    // قبول طلب صداقة
    socket.on('accept-friend-request', (fromUsername) => {
        if (!currentUser) return;
        
        const current = users[currentUser];
        const from = users[fromUsername];
        
        if (!current || !from) return;
        
        current.pendingRequests = current.pendingRequests.filter(u => u !== fromUsername);
        
        if (!current.friends.includes(fromUsername)) current.friends.push(fromUsername);
        if (!from.friends.includes(currentUser)) from.friends.push(currentUser);
        
        io.to(current.socketId).emit('friend-request-accepted', { from: fromUsername, fromName: from.displayName });
        io.to(from.socketId).emit('friend-request-accepted', { from: currentUser, fromName: current.displayName });
    });
    
    // رفض طلب صداقة
    socket.on('reject-friend-request', (fromUsername) => {
        if (!currentUser) return;
        const current = users[currentUser];
        current.pendingRequests = current.pendingRequests.filter(u => u !== fromUsername);
        socket.emit('friend-request-rejected', { from: fromUsername });
    });
    
    // إرسال رسالة
    socket.on('send-message', (data) => {
        if (!currentUser) return;
        const { to, message } = data;
        const targetUser = users[to];
        
        if (targetUser && users[currentUser].friends.includes(to)) {
            io.to(targetUser.socketId).emit('new-message', {
                from: currentUser,
                fromName: users[currentUser].displayName,
                message: message,
                time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
            });
            socket.emit('message-sent', { to, message });
        }
    });
    
    // منشور جديد
    socket.on('new-post', (data) => {
        if (!currentUser) return;
        const newPost = {
            id: Date.now(),
            username: currentUser,
            displayName: users[currentUser].displayName,
            text: data.text,
            time: new Date().toISOString(),
            likes: 0
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
        const index = posts.findIndex(p => p.id == postId);
        if (index !== -1 && posts[index].username === currentUser) {
            posts.splice(index, 1);
            io.emit('post-deleted', postId);
        }
    });
    
    socket.on('disconnect', () => {
        if (currentUser && users[currentUser]) {
            console.log(`👋 مستخدم غادر: ${currentUser}`);
            io.emit('user-offline', { username: currentUser });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 السيرفر شغال على http://localhost:${PORT}`);
});
