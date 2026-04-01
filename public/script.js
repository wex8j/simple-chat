let socket;
let currentUser = null;
let currentChatWith = null;
let conversations = JSON.parse(localStorage.getItem('conversations') || '{}');
let blockedUsers = JSON.parse(localStorage.getItem('blocked_users') || '[]');

// تسجيل الدخول
document.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('social_user');
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            login(user.username, user.displayName);
        } catch(e) {}
    }
    
    document.getElementById('login-btn')?.addEventListener('click', () => {
        const username = document.getElementById('login-username').value.trim().toLowerCase();
        const displayName = document.getElementById('login-displayname').value.trim();
        
        if (!username || !displayName) {
            showError('الرجاء ملء جميع الحقول');
            return;
        }
        
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
            showError('يوزر نيم: حروف وأرقام فقط (3-20)');
            return;
        }
        
        login(username, displayName);
    });
    
    document.getElementById('logout-btn')?.addEventListener('click', () => {
        localStorage.removeItem('social_user');
        localStorage.removeItem('conversations');
        location.reload();
    });
    
    // التنقل بين الصفحات
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const page = btn.dataset.page;
            document.getElementById('home-page').style.display = page === 'home' ? 'block' : 'none';
            document.getElementById('chat-page').style.display = page === 'chat' ? 'block' : 'none';
            document.getElementById('profile-page').style.display = page === 'profile' ? 'block' : 'none';
            
            if (page === 'chat') loadConversationsList();
            if (page === 'profile') updateProfilePage();
        });
    });
    
    // زر النشر
    document.getElementById('post-btn')?.addEventListener('click', () => {
        const text = document.getElementById('post-text').value.trim();
        if (text && socket) {
            socket.emit('new-post', { text, image: null });
            document.getElementById('post-text').value = '';
        }
    });
    
    // العودة من الدردشة
    document.getElementById('back-chat-btn')?.addEventListener('click', () => {
        document.getElementById('chat-area').style.display = 'none';
        document.getElementById('conversations-list').style.display = 'block';
        currentChatWith = null;
    });
    
    // حظر من الدردشة
    document.getElementById('block-chat-btn')?.addEventListener('click', () => {
        if (currentChatWith && socket) {
            socket.emit('block-user', currentChatWith);
            document.getElementById('chat-area').style.display = 'none';
            document.getElementById('conversations-list').style.display = 'block';
            currentChatWith = null;
            loadConversationsList();
        }
    });
    
    // إرسال رسالة
    document.getElementById('send-chat-btn')?.addEventListener('click', sendChatMessage);
    document.getElementById('chat-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });
    
    // التبويبات في الملف الشخصي
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
        });
    });
});

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (msg && currentChatWith && socket) {
        const roomId = [currentUser.username, currentChatWith].sort().join('-');
        socket.emit('send-chat-message', { roomId, message: msg });
        
        // حفظ الرسالة محلياً
        if (!conversations[roomId]) conversations[roomId] = [];
        conversations[roomId].push({
            from: currentUser.username,
            message: msg,
            time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
        });
        localStorage.setItem('conversations', JSON.stringify(conversations));
        
        addMessageToChat(msg, true);
        input.value = '';
    }
}

function addMessageToChat(message, isOwn, time) {
    const messagesDiv = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-message' + (isOwn ? ' own' : '');
    div.innerHTML = `
        <div class="message-bubble">${escapeHtml(message)}</div>
        <div class="message-time">${time || new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</div>
    `;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function login(username, displayName) {
    socket = io();
    
    socket.on('connect', () => {
        socket.emit('login', { username, displayName });
    });
    
    socket.on('login-success', (data) => {
        currentUser = { username: data.username, displayName: data.displayName };
        localStorage.setItem('social_user', JSON.stringify(currentUser));
        
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('user-name').textContent = data.displayName;
        document.getElementById('user-username').textContent = `@${data.username}`;
        
        updateUsersList(data.users);
        loadPosts(data.posts);
        updateProfilePage();
    });
    
    socket.on('login-error', (msg) => showError(msg));
    socket.on('post-added', (post) => addPostToFeed(post));
    socket.on('post-deleted', (postId) => removePostFromFeed(postId));
    socket.on('user-online', (user) => updateUserStatus(user.username, true));
    socket.on('user-offline', (user) => updateUserStatus(user.username, false));
    
    // طلبات المحادثة
    socket.on('new-request', (data) => {
        showRequestNotification(data);
    });
    
    socket.on('request-accepted', (data) => {
        addSystemMessage(`✨ ${data.withName} قبل طلب المحادثة`);
        loadConversationsList();
    });
    
    socket.on('chat-message', (data) => {
        const roomId = [currentUser.username, data.from].sort().join('-');
        if (!conversations[roomId]) conversations[roomId] = [];
        conversations[roomId].push({
            from: data.from,
            message: data.message,
            time: data.time
        });
        localStorage.setItem('conversations', JSON.stringify(conversations));
        
        if (currentChatWith === data.from) {
            addMessageToChat(data.message, false, data.time);
        } else {
            updateConversationBadge(data.from);
        }
    });
}

function showRequestNotification(data) {
    // عرض إشعار في واجهة المستخدم
    const usersList = document.getElementById('users-list');
    const userCard = Array.from(usersList.children).find(
        card => card.dataset?.username === data.from
    );
    if (userCard) {
        const actionsDiv = userCard.querySelector('.user-card-actions');
        if (actionsDiv) {
            actionsDiv.innerHTML = `
                <button class="accept-btn" data-user="${data.from}">قبول</button>
                <button class="reject-btn" data-user="${data.from}">رفض</button>
            `;
            actionsDiv.querySelector('.accept-btn').onclick = () => {
                socket.emit('accept-request', data.from);
                actionsDiv.innerHTML = '<span style="color:green;">✓ تم القبول</span>';
            };
            actionsDiv.querySelector('.reject-btn').onclick = () => {
                socket.emit('reject-request', data.from);
                actionsDiv.innerHTML = '<span style="color:red;">✗ تم الرفض</span>';
            };
        }
    }
}

function updateUsersList(users) {
    const container = document.getElementById('users-list');
    if (!container) return;
    
    container.innerHTML = '';
    users.forEach(user => {
        if (user.username === currentUser?.username) return;
        
        const div = document.createElement('div');
        div.className = 'user-card';
        div.dataset.username = user.username;
        div.innerHTML = `
            <div class="user-card-info">
                <div class="user-card-name">
                    <span class="user-card-status ${user.online ? '' : 'offline'}"></span>
                    ${escapeHtml(user.displayName)}
                </div>
                <div class="user-card-username">@${escapeHtml(user.username)}</div>
            </div>
            <div class="user-card-actions">
                <button class="request-btn" data-user="${user.username}">💬 محادثة</button>
            </div>
        `;
        
        const requestBtn = div.querySelector('.request-btn');
        requestBtn.onclick = () => {
            socket.emit('send-request', user.username);
            requestBtn.textContent = '✓ تم الإرسال';
            requestBtn.disabled = true;
        };
        
        container.appendChild(div);
    });
}

function updateUserStatus(username, online) {
    const container = document.getElementById('users-list');
    if (!container) return;
    
    const userCard = Array.from(container.children).find(
        card => card.dataset.username === username
    );
    if (userCard) {
        const statusSpan = userCard.querySelector('.user-card-status');
        if (statusSpan) {
            if (online) statusSpan.classList.remove('offline');
            else statusSpan.classList.add('offline');
        }
    }
}

function loadPosts(posts) {
    const container = document.getElementById('posts-feed');
    if (!container) return;
    
    container.innerHTML = '';
    if (posts.length === 0) {
        container.innerHTML = '<div class="empty-state">لا توجد منشورات</div>';
        return;
    }
    
    posts.forEach(post => {
        addPostToFeed(post);
    });
}

function addPostToFeed(post) {
    const container = document.getElementById('posts-feed');
    if (!container) return;
    
    const isOwn = post.username === currentUser?.username;
    const div = document.createElement('div');
    div.className = 'post-card';
    div.dataset.id = post.id;
    div.innerHTML = `
        <div class="post-header">
            <div class="post-avatar">👤</div>
            <div class="post-user-info">
                <div class="post-name">${escapeHtml(post.displayName)}</div>
                <div class="post-username">@${escapeHtml(post.username)}</div>
            </div>
            <div class="post-time">${new Date(post.time).toLocaleTimeString('ar-EG')}</div>
        </div>
        <div class="post-text">${escapeHtml(post.text)}</div>
        <div class="post-actions-bar">
            <button class="like-btn">❤️ ${post.likes || 0}</button>
            ${isOwn ? '<button class="delete-post-btn">🗑️ حذف</button>' : ''}
        </div>
    `;
    
    div.querySelector('.like-btn').onclick = () => {
        socket.emit('like-post', post.id);
    };
    
    if (isOwn) {
        div.querySelector('.delete-post-btn').onclick = () => {
            socket.emit('delete-post', post.id);
        };
    }
    
    container.prepend(div);
}

function removePostFromFeed(postId) {
    const post = document.querySelector(`.post-card[data-id="${postId}"]`);
    if (post) post.remove();
}

function loadConversationsList() {
    const container = document.getElementById('conversations-list');
    if (!container) return;
    
    const roomIds = Object.keys(conversations);
    if (roomIds.length === 0) {
        container.innerHTML = '<div class="empty-state">لا توجد محادثات بعد</div>';
        return;
    }
    
    container.innerHTML = '';
    roomIds.forEach(roomId => {
        const otherUser = roomId.split('-').find(u => u !== currentUser.username);
        const lastMsg = conversations[roomId][conversations[roomId].length - 1];
        
        const div = document.createElement('div');
        div.className = 'conversation-item';
        div.innerHTML = `
            <div class="conversation-info">
                <div class="conversation-name">${escapeHtml(otherUser)}</div>
                <div class="conversation-status">${lastMsg ? lastMsg.message.substring(0, 30) : '...'}</div>
            </div>
        `;
        div.onclick = () => openChat(otherUser, roomId);
        container.appendChild(div);
    });
}

function openChat(username, roomId) {
    currentChatWith = username;
    document.getElementById('conversations-list').style.display = 'none';
    document.getElementById('chat-area').style.display = 'flex';
    document.getElementById('chat-partner-name').textContent = username;
    document.getElementById('chat-messages').innerHTML = '';
    
    const messages = conversations[roomId] || [];
    messages.forEach(msg => {
        addMessageToChat(msg.message, msg.from === currentUser.username, msg.time);
    });
}

function updateConversationBadge(username) {
    // تحديث قائمة المحادثات
    loadConversationsList();
}

function updateProfilePage() {
    if (!currentUser) return;
    
    document.getElementById('profile-name').textContent = currentUser.displayName;
    document.getElementById('profile-username').textContent = `@${currentUser.username}`;
    
    // عرض منشوراتي
    const myPostsContainer = document.getElementById('my-posts');
    if (myPostsContainer) {
        const myPosts = Array.from(document.querySelectorAll('.post-card'))
            .filter(post => post.querySelector('.delete-post-btn'));
        
        if (myPosts.length === 0) {
            myPostsContainer.innerHTML = '<div class="empty-state">لا توجد منشورات</div>';
        } else {
            myPostsContainer.innerHTML = '';
            myPosts.forEach(post => {
                myPostsContainer.appendChild(post.cloneNode(true));
            });
        }
    }
    
    // عرض المحظورين
    const blockedContainer = document.getElementById('blocked-list');
    if (blockedContainer) {
        if (blockedUsers.length === 0) {
            blockedContainer.innerHTML = '<div class="empty-state">لا يوجد مستخدمون محظورون</div>';
        } else {
            blockedContainer.innerHTML = '';
            blockedUsers.forEach(user => {
                const div = document.createElement('div');
                div.className = 'blocked-item';
                div.innerHTML = `
                    <span>${escapeHtml(user)}</span>
                    <button class="unblock-btn" data-user="${user}">إلغاء الحظر</button>
                `;
                div.querySelector('.unblock-btn').onclick = () => {
                    blockedUsers = blockedUsers.filter(u => u !== user);
                    localStorage.setItem('blocked_users', JSON.stringify(blockedUsers));
                    updateProfilePage();
                    if (socket) socket.emit('unblock-user', user);
                };
                blockedContainer.appendChild(div);
            });
        }
    }
}

function addSystemMessage(text) {
    const messagesDiv = document.getElementById('chat-messages');
    if (!messagesDiv) return;
    const div = document.createElement('div');
    div.style.textAlign = 'center';
    div.style.color = 'rgba(255,255,255,0.6)';
    div.style.fontSize = '12px';
    div.style.padding = '8px';
    div.textContent = text;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function showError(msg) {
    const errorDiv = document.getElementById('error-msg');
    if (errorDiv) {
        errorDiv.textContent = msg;
        errorDiv.style.display = 'block';
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 3000);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
                          }
