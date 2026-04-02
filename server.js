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

const users = {};
let posts = [];
const bannedUsers = [];
const mutedUsers = [];
const tempBannedUsers = [];

// منشور ترحيبي
posts.push({
    id: Date.now(),
    username: 'baghdad',
    displayName: 'دردشة بغداد لايف',
    avatar: '🇮🇶',
    avatarType: 'emoji',
    text: '✨ هلا بيكم في دردشة بغداد لايف ✨\nنرجو من المستخدمين الالتزام بالاحترام والتواصل الإيجابي 🤍',
    time: new Date().toISOString(),
    likes: 0,
    comments: []
});

function isTempBanned(username) {
    const tempBan = tempBannedUsers.find(b => b.username === username);
    if (tempBan && tempBan.until > Date.now()) return true;
    if (tempBan) {
        const index = tempBannedUsers.findIndex(b => b.username === username);
        tempBannedUsers.splice(index, 1);
        return false;
    }
    return false;
}

function broadcastUsers() {
    const userList = Object.keys(users).map(u => ({
        username: u,
        displayName: users[u].displayName,
        avatar: users[u].avatar || '👤',
        avatarType: users[u].avatarType || 'emoji',
        isAdmin: users[u].isAdmin || false
    }));
    io.emit('users-list', userList);
}

io.on('connection', (socket) => {
    console.log('✅ مستخدم جديد:', socket.id);
    let currentUser = null;

    socket.on('login', (data) => {
        const { username, password, displayName, avatar, avatarType } = data;
        
        if (bannedUsers.includes(username)) {
            socket.emit('login-error', '⛔ حسابك محظور بشكل دائم');
            return;
        }
        if (isTempBanned(username)) {
            const tempBan = tempBannedUsers.find(b => b.username === username);
            const remaining = Math.ceil((tempBan.until - Date.now()) / 60000);
            socket.emit('login-error', `⏰ حسابك محظور مؤقتاً لمدة ${remaining} دقيقة`);
            return;
        }
        
        if (!users[username]) {
            users[username] = {
                password: password,
                displayName: displayName || username,
                avatar: avatar || '👤',
                avatarType: avatarType || 'emoji',
                friends: [],
                requests: [],
                socketId: socket.id,
                isAdmin: username === '3tx'
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
            avatar: users[username].avatar,
            avatarType: users[username].avatarType,
            friends: users[username].friends,
            requests: users[username].requests,
            isAdmin: users[username].isAdmin || false,
            posts: posts,
            users: Object.keys(users).map(u => ({
                username: u,
                displayName: users[u].displayName,
                avatar: users[u].avatar || '👤',
                avatarType: users[u].avatarType || 'emoji',
                isAdmin: users[u].isAdmin || false
            }))
        });
        
        broadcastUsers();
        socket.broadcast.emit('user-online', { username, displayName: users[username].displayName });
    });
    
    socket.on('update-avatar', (data) => {
        if (!currentUser) return;
        if (currentUser === '3tx') return;
        users[currentUser].avatar = data.avatar;
        users[currentUser].avatarType = 'image';
        io.emit('avatar-updated', { username: currentUser, avatar: data.avatar });
        broadcastUsers();
        socket.emit('avatar-updated-success');
    });
    
    socket.on('refresh-users', () => {
        if (currentUser) {
            const userList = Object.keys(users).map(u => ({
                username: u,
                displayName: users[u].displayName,
                avatar: users[u].avatar || '👤',
                avatarType: users[u].avatarType || 'emoji',
                isAdmin: users[u].isAdmin || false
            }));
            socket.emit('users-refreshed', userList);
        }
    });
    
    socket.on('add-comment', (data) => {
        const { postId, comment } = data;
        const post = posts.find(p => p.id == postId);
        if (post && currentUser) {
            post.comments.push({
                username: currentUser,
                displayName: users[currentUser].displayName,
                avatar: users[currentUser].avatar || '👤',
                avatarType: users[currentUser].avatarType || 'emoji',
                text: comment,
                time: new Date().toLocaleTimeString('ar-EG')
            });
            io.emit('post-updated', post);
        }
    });
    
    socket.on('add-friend', (toUsername) => {
        if (!currentUser) return;
        if (mutedUsers.includes(currentUser)) {
            socket.emit('muted-error', 'أنت مكتوم ولا يمكنك إرسال طلبات');
            return;
        }
        const target = users[toUsername];
        if (!target) return;
        if (users[currentUser].friends.includes(toUsername)) return;
        
        if (!target.requests.includes(currentUser)) {
            target.requests.push(currentUser);
            io.to(target.socketId).emit('new-request', {
                from: currentUser,
                fromName: users[currentUser].displayName
            });
            socket.emit('request-sent', { to: toUsername });
        }
    });
    
    socket.on('accept-friend', (fromUsername) => {
        if (!currentUser) return;
        const current = users[currentUser];
        const from = users[fromUsername];
        
        current.requests = current.requests.filter(u => u !== fromUsername);
        if (!current.friends.includes(fromUsername)) current.friends.push(fromUsername);
        if (!from.friends.includes(currentUser)) from.friends.push(currentUser);
        
        io.to(current.socketId).emit('request-accepted', { from: fromUsername, fromName: from.displayName });
        io.to(from.socketId).emit('request-accepted', { from: currentUser, fromName: current.displayName });
        broadcastUsers();
    });
    
    socket.on('reject-friend', (fromUsername) => {
        if (!currentUser) return;
        users[currentUser].requests = users[currentUser].requests.filter(u => u !== fromUsername);
    });
    
    socket.on('private-message', (data) => {
        if (!currentUser) return;
        if (mutedUsers.includes(currentUser)) {
            socket.emit('muted-error', 'أنت مكتوم ولا يمكنك إرسال رسائل');
            return;
        }
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
    
    socket.on('new-post', (data) => {
        if (!currentUser) return;
        if (mutedUsers.includes(currentUser)) {
            socket.emit('muted-error', 'أنت مكتوم ولا يمكنك النشر');
            return;
        }
        posts.unshift({
            id: Date.now(),
            username: currentUser,
            displayName: users[currentUser].displayName,
            avatar: users[currentUser].avatar || '👤',
            avatarType: users[currentUser].avatarType || 'emoji',
            text: data.text,
            time: new Date().toISOString(),
            likes: 0,
            comments: []
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
    
    socket.on('update-profile', (data) => {
        if (!currentUser) return;
        if (data.displayName) users[currentUser].displayName = data.displayName;
        io.emit('profile-updated', { username: currentUser, displayName: users[currentUser].displayName });
        broadcastUsers();
    });
    
    socket.on('ban-user', (targetUsername) => {
        if (!currentUser || !users[currentUser]?.isAdmin) return;
        if (!bannedUsers.includes(targetUsername)) {
            bannedUsers.push(targetUsername);
            const targetSocket = users[targetUsername]?.socketId;
            if (targetSocket) {
                io.to(targetSocket).emit('banned-permanent', { by: currentUser });
                const clientSocket = io.sockets.sockets.get(targetSocket);
                if (clientSocket) clientSocket.disconnect();
            }
            io.emit('user-banned', { username: targetUsername, by: currentUser });
            broadcastUsers();
        }
    });
    
    socket.on('temp-ban-user', (data) => {
        if (!currentUser || !users[currentUser]?.isAdmin) return;
        const { username, minutes } = data;
        const until = Date.now() + (minutes * 60 * 1000);
        tempBannedUsers.push({ username, until });
        const targetSocket = users[username]?.socketId;
        if (targetSocket) {
            io.to(targetSocket).emit('temp-banned', { by: currentUser, minutes });
            const clientSocket = io.sockets.sockets.get(targetSocket);
            if (clientSocket) clientSocket.disconnect();
        }
        io.emit('user-temp-banned', { username, by: currentUser, minutes });
        broadcastUsers();
    });
    
    socket.on('mute-user', (targetUsername) => {
        if (!currentUser || !users[currentUser]?.isAdmin) return;
        if (!mutedUsers.includes(targetUsername)) {
            mutedUsers.push(targetUsername);
            io.to(users[targetUsername]?.socketId).emit('muted', { by: currentUser });
            io.emit('user-muted', { username: targetUsername, by: currentUser });
        }
    });
    
    socket.on('unmute-user', (targetUsername) => {
        if (!currentUser || !users[currentUser]?.isAdmin) return;
        const index = mutedUsers.indexOf(targetUsername);
        if (index !== -1) {
            mutedUsers.splice(index, 1);
            io.to(users[targetUsername]?.socketId).emit('unmuted', { by: currentUser });
            io.emit('user-unmuted', { username: targetUsername, by: currentUser });
        }
    });
    
    socket.on('disconnect', () => {
        if (currentUser && users[currentUser]) {
            broadcastUsers();
            io.emit('user-offline', { username: currentUser });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 دردشة بغداد لايف شغالة على http://localhost:${PORT}`);
    console.log(`👑 المشرف: 3tx`);
});
