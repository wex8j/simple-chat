const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ===== قاعدة البيانات في الذاكرة =====
const users = {};
const posts = [];
let postId = 1;
const connectedUsers = {}; // username -> socket.id
const socketToUser = {};   // socket.id -> username

// حساب المشرف الثابت
users['3tx'] = {
    password: 'admin2024',
    displayName: 'المشرف',
    avatar: 'https://g.top4top.io/p_37443983d0.gif',
    avatarType: 'gif',
    isAdmin: true,
    friends: [],
    requests: []
};

// ===== خدمة ملف الواجهة =====
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ===== Socket.io =====
io.on('connection', (socket) => {

    // ---- تسجيل الدخول / التسجيل ----
    socket.on('login', ({ username, password, displayName }) => {
        username = username.trim().toLowerCase();
        if (!username || !password) return socket.emit('login-error', 'يرجى ملء جميع الحقول');

        if (users[username]) {
            if (users[username].password !== password)
                return socket.emit('login-error', 'كلمة السر غلط');
        } else {
            // تسجيل مستخدم جديد
            users[username] = {
                password,
                displayName: displayName || username,
                avatar: '👤',
                avatarType: 'emoji',
                isAdmin: false,
                friends: [],
                requests: []
            };
            // إشعار بقية المستخدمين بمستخدم جديد
            socket.broadcast.emit('user-joined', {
                username,
                displayName: displayName || username,
                avatar: '👤',
                avatarType: 'emoji'
            });
        }

        connectedUsers[username] = socket.id;
        socketToUser[socket.id] = username;

        const u = users[username];
        socket.emit('login-success', {
            username,
            displayName: u.displayName,
            avatar: u.avatar,
            avatarType: u.avatarType,
            isAdmin: u.isAdmin,
            friends: u.friends,
            requests: u.requests,
            posts,
            users: Object.keys(users).map(k => ({
                username: k,
                displayName: users[k].displayName,
                avatar: users[k].avatar,
                avatarType: users[k].avatarType
            }))
        });
    });

    // ---- منشور جديد ----
    socket.on('new-post', ({ text }) => {
        const username = socketToUser[socket.id];
        if (!username || !text?.trim()) return;
        const u = users[username];
        const post = {
            id: postId++,
            username,
            displayName: u.displayName,
            avatar: u.avatar,
            avatarType: u.avatarType,
            text: text.trim(),
            time: new Date().toISOString(),
            likes: 0,
            likedBy: []
        };
        posts.push(post);
        io.emit('post-added', post);
    });

    // ---- إعجاب بمنشور ----
    socket.on('like-post', (id) => {
        const username = socketToUser[socket.id];
        const post = posts.find(p => p.id === id);
        if (!post || !username) return;
        if (post.likedBy.includes(username)) {
            // إلغاء الإعجاب
            post.likes--;
            post.likedBy = post.likedBy.filter(u => u !== username);
        } else {
            post.likes++;
            post.likedBy.push(username);
        }
        io.emit('post-updated', post);
    });

    // ---- حذف منشور ----
    socket.on('delete-post', (id) => {
        const username = socketToUser[socket.id];
        const idx = posts.findIndex(p => p.id === id && p.username === username);
        if (idx !== -1) {
            posts.splice(idx, 1);
            io.emit('post-deleted', id);
        }
    });

    // ---- إضافة صديق ----
    socket.on('add-friend', (toUsername) => {
        const from = socketToUser[socket.id];
        if (!from || !users[toUsername] || from === toUsername) return;
        if (users[toUsername].requests.includes(from) || users[toUsername].friends.includes(from)) return;

        users[toUsername].requests.push(from);

        if (connectedUsers[toUsername]) {
            io.to(connectedUsers[toUsername]).emit('new-request', {
                from,
                fromName: users[from].displayName
            });
        }
    });

    // ---- قبول طلب صداقة ----
    socket.on('accept-friend', (fromUsername) => {
        const to = socketToUser[socket.id];
        if (!to || !users[fromUsername]) return;

        if (!users[to].friends.includes(fromUsername)) users[to].friends.push(fromUsername);
        if (!users[fromUsername].friends.includes(to)) users[fromUsername].friends.push(to);

        users[to].requests = users[to].requests.filter(u => u !== fromUsername);
        users[fromUsername].requests = users[fromUsername].requests.filter(u => u !== to);

        socket.emit('request-accepted', { from: fromUsername, fromName: users[fromUsername].displayName });

        if (connectedUsers[fromUsername]) {
            io.to(connectedUsers[fromUsername]).emit('request-accepted', {
                from: to,
                fromName: users[to].displayName
            });
        }
    });

    // ---- رفض طلب صداقة ----
    socket.on('reject-friend', (fromUsername) => {
        const to = socketToUser[socket.id];
        if (!to) return;
        users[to].requests = users[to].requests.filter(u => u !== fromUsername);
    });

    // ---- رسالة خاصة ----
    socket.on('private-message', ({ to, message }) => {
        const from = socketToUser[socket.id];
        if (!from || !message?.trim()) return;

        const time = new Date().toLocaleTimeString('ar-IQ');

        if (connectedUsers[to]) {
            io.to(connectedUsers[to]).emit('new-message', { from, message, time });
        }
    });

    // ---- تحديث الصورة الشخصية ----
    socket.on('update-avatar', ({ avatar }) => {
        const username = socketToUser[socket.id];
        if (!username || users[username]?.isAdmin) return;

        users[username].avatar = avatar;
        users[username].avatarType = 'image';

        socket.emit('avatar-updated-success');
        io.emit('avatar-updated', { username, avatar });

        // تحديث المنشورات القديمة
        posts.filter(p => p.username === username).forEach(p => {
            p.avatar = avatar;
            p.avatarType = 'image';
        });
    });

    // ---- قطع الاتصال ----
    socket.on('disconnect', () => {
        const username = socketToUser[socket.id];
        if (username) {
            delete connectedUsers[username];
            delete socketToUser[socket.id];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ السيرفر يشتغل على: http://localhost:${PORT}`);
});
