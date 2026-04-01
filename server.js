const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

const users = {};
let posts = [];

// منشور تجريبي
posts.push({
    id: 1,
    username: '3tx',
    displayName: 'أبو علي',
    text: 'مرحباً بالجميع في بغداد لايف! 🎉 منصة التواصل العراقية',
    time: new Date().toISOString(),
    likes: 5
});

io.on('connection', (socket) => {
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
    });
    
    // طلب صداقة
    socket.on('send-request', (to) => {
        if (!currentUser) return;
        const target = users[to];
        if (!target || users[currentUser].friends.includes(to)) return;
        if (!target.requests.includes(currentUser)) {
            target.requests.push(currentUser);
            io.to(target.socketId).emit('new-request', {
                from: currentUser,
                fromName: users[currentUser].displayName
            });
        }
    });
    
    // قبول طلب
    socket.on('accept-request', (from) => {
        if (!currentUser) return;
        const current = users[currentUser];
        const fromUser = users[from];
        current.requests = current.requests.filter(u => u !== from);
        if (!current.friends.includes(from)) current.friends.push(from);
        if (!fromUser.friends.includes(currentUser)) fromUser.friends.push(currentUser);
        io.to(current.socketId).emit('request-accepted', { from, fromName: fromUser.displayName });
        io.to(fromUser.socketId).emit('request-accepted', { from: currentUser, fromName: current.displayName });
    });
    
    // رفض طلب
    socket.on('reject-request', (from) => {
        if (!currentUser) return;
        users[currentUser].requests = users[currentUser].requests.filter(u => u !== from);
    });
    
    // رسالة خاصة
    socket.on('private-message', (data) => {
        if (!currentUser) return;
        const { to, message } = data;
        const target = users[to];
        if (target && users[currentUser].friends.includes(to)) {
            io.to(target.socketId).emit('new-private-message', {
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
    
    socket.on('like-post', (id) => {
        let post = posts.find(p => p.id == id);
        if (post) { post.likes++; io.emit('post-updated', post); }
    });
    
    socket.on('delete-post', (id) => {
        let index = posts.findIndex(p => p.id == id);
        if (index !== -1 && posts[index].username === currentUser) {
            posts.splice(index, 1);
            io.emit('post-deleted', id);
        }
    });
    
    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ سيرفر بغداد لايف شغال`));
