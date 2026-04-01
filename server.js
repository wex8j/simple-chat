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

// تخزين المستخدمين
const users = {}; // { socketId: { username, displayName, looking, partner } }
const waitingQueue = []; // قائمة انتظار الباحثين عن صديق

io.on('connection', (socket) => {
    console.log('مستخدم جديد:', socket.id);

    // تسجيل الدخول
    socket.on('set-user', (userData) => {
        const { username, displayName } = userData;
        
        // التحقق إذا اليوزر نيم مستخدم
        const existingUser = Object.values(users).find(u => u.username === username);
        if (existingUser) {
            socket.emit('username-taken');
            return;
        }
        
        // حفظ المستخدم
        users[socket.id] = {
            username: username,
            displayName: displayName,
            looking: false,
            partner: null
        };
        
        socket.emit('user-set', { username, displayName });
        updateOnlineCount();
    });

    // بحث عن صديق
    socket.on('find-partner', () => {
        const user = users[socket.id];
        if (!user) return;
        
        // إذا كان بالفعل في دردشة
        if (user.partner) {
            socket.emit('already-in-chat');
            return;
        }
        
        user.looking = true;
        
        // البحث عن شخص في قائمة الانتظار
        if (waitingQueue.length > 0) {
            const partnerId = waitingQueue.shift();
            const partner = users[partnerId];
            
            if (partner && !partner.partner) {
                // تطابق ناجح
                partner.looking = false;
                partner.partner = socket.id;
                user.looking = false;
                user.partner = partnerId;
                
                // إعلام الطرفين
                io.to(socket.id).emit('matched', {
                    partnerId: partnerId,
                    partnerName: partner.displayName,
                    partnerUsername: partner.username
                });
                io.to(partnerId).emit('matched', {
                    partnerId: socket.id,
                    partnerName: user.displayName,
                    partnerUsername: user.username
                });
                
                updateOnlineCount();
                return;
            }
        }
        
        // إضافة إلى قائمة الانتظار
        waitingQueue.push(socket.id);
        socket.emit('waiting', { position: waitingQueue.length });
    });

    // إرسال رسالة للشريك
    socket.on('send-message', (data) => {
        const user = users[socket.id];
        if (!user || !user.partner) {
            socket.emit('no-partner');
            return;
        }
        
        const partner = users[user.partner];
        if (!partner) {
            socket.emit('partner-disconnected');
            user.partner = null;
            return;
        }
        
        // إرسال الرسالة للشريك
        io.to(user.partner).emit('receive-message', {
            message: data.message,
            fromName: user.displayName,
            time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
        });
    });

    // تخطي الشريك الحالي
    socket.on('skip-partner', () => {
        const user = users[socket.id];
        if (!user) return;
        
        const oldPartnerId = user.partner;
        if (oldPartnerId) {
            const oldPartner = users[oldPartnerId];
            if (oldPartner) {
                // إعلام الشريك بأن الطرف الآخر غادر
                io.to(oldPartnerId).emit('partner-skipped');
                oldPartner.partner = null;
                oldPartner.looking = false;
                // إعادة الشريك إلى قائمة الانتظار
                waitingQueue.push(oldPartnerId);
            }
            user.partner = null;
        }
        
        user.looking = false;
        
        // بدء بحث جديد
        socket.emit('searching');
        setTimeout(() => {
            if (users[socket.id] && !users[socket.id].partner) {
                socket.emit('find-partner');
            }
        }, 500);
    });

    // إنهاء الدردشة
    socket.on('end-chat', () => {
        const user = users[socket.id];
        if (!user) return;
        
        const partnerId = user.partner;
        if (partnerId) {
            const partner = users[partnerId];
            if (partner) {
                partner.partner = null;
                partner.looking = false;
                io.to(partnerId).emit('partner-ended');
            }
            user.partner = null;
        }
        
        user.looking = false;
        socket.emit('chat-ended');
    });

    // قطع الاتصال
    socket.on('disconnect', () => {
        console.log('مستخدم غادر:', socket.id);
        
        const user = users[socket.id];
        if (user) {
            // إعلام الشريك إذا كان موجود
            if (user.partner) {
                const partner = users[user.partner];
                if (partner) {
                    partner.partner = null;
                    partner.looking = false;
                    io.to(user.partner).emit('partner-disconnected');
                }
            }
            
            // إزالة من قائمة الانتظار
            const index = waitingQueue.indexOf(socket.id);
            if (index !== -1) waitingQueue.splice(index, 1);
            
            delete users[socket.id];
        }
        
        updateOnlineCount();
    });
    
    function updateOnlineCount() {
        const onlineCount = Object.keys(users).length;
        io.emit('online-count', onlineCount);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ السيرفر شغال على http://localhost:${PORT}`);
    console.log(`🚀 تطبيق بحث عن أصدقاء - Random Match`);
});
