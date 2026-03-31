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

const users = {}; // { socketId: { username, avatar } }

io.on('connection', (socket) => {
    console.log('مستخدم جديد:', socket.id);

    // تعيين بيانات المستخدم
    socket.on('set-user', (userData) => {
        users[socket.id] = {
            username: userData.username,
            avatar: userData.avatar
        };
        
        // إرسال قائمة المستخدمين للجميع
        const userList = Object.values(users);
        io.emit('users-list', userList);
        
        // إعلان دخول المستخدم
        io.emit('user-joined', {
            username: userData.username,
            avatar: userData.avatar
        });
    });

    // استقبال رسالة
    socket.on('send-message', (data) => {
        io.emit('receive-message', {
            username: data.username,
            avatar: data.avatar,
            message: data.message,
            time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
        });
    });

    // قطع الاتصال
    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            io.emit('user-left', {
                username: user.username,
                avatar: user.avatar
            });
            delete users[socket.id];
            
            const userList = Object.values(users);
            io.emit('users-list', userList);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ السيرفر شغال على http://localhost:${PORT}`);
});
