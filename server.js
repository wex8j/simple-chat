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

const users = {};

io.on('connection', (socket) => {
    console.log('مستخدم جديد:', socket.id);

    socket.on('set-username', (username) => {
        users[socket.id] = username;
        io.emit('user-joined', `${username} دخل الدردشة`);
        io.emit('users-list', Object.values(users));
    });

    socket.on('send-message', (data) => {
        const username = users[socket.id] || 'زائر';
        io.emit('receive-message', {
            username: username,
            message: data.message,
            time: new Date().toLocaleTimeString()
        });
    });

    socket.on('disconnect', () => {
        const username = users[socket.id];
        if (username) {
            io.emit('user-left', `${username} غادر`);
            delete users[socket.id];
            io.emit('users-list', Object.values(users));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ السيرفر شغال على http://localhost:${PORT}`);
});
