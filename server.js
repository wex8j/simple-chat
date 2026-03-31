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

const users = {}; // { username: { socketId, displayName } }
const socketToUser = {}; // { socketId: username }

io.on('connection', (socket) => {
    console.log('مستخدم جديد:', socket.id);

    socket.on('set-user', (userData) => {
        const { username, displayName } = userData;
        
        // التحقق إذا اليوزر نيم مستخدم
        if (users[username]) {
            socket.emit('username-taken');
            return;
        }
        
        // حفظ المستخدم
        users[username] = {
            socketId: socket.id,
            displayName: displayName
        };
        socketToUser[socket.id] = username;
        
        // إرسال قائمة المستخدمين
        const userList = Object.keys(users).map(u => ({
            username: u,
            displayName: users[u].displayName
        }));
        io.emit('users-list', userList);
        
        // إعلان دخول المستخدم
        io.emit('user-joined', {
            username: username,
            displayName: displayName
        });
    });

    socket.on('send-message', (data) => {
        io.emit('receive-message', {
            username: data.username,
            displayName: data.displayName,
            message: data.message,
            time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
        });
    });

    socket.on('disconnect', () => {
        const username = socketToUser[socket.id];
        if (username && users[username]) {
            const userData = users[username];
            io.emit('user-left', {
                username: username,
                displayName: userData.displayName
            });
            delete users[username];
            delete socketToUser[socket.id];
            
            const userList = Object.keys(users).map(u => ({
                username: u,
                displayName: users[u].displayName
            }));
            io.emit('users-list', userList);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ السيرفر شغال على http://localhost:${PORT}`);
});
