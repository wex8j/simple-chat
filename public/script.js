let socket;
let currentUser = null;
let currentChatWith = null;
let conversations = JSON.parse(localStorage.getItem('conversations') || '{}');
let blockedUsers = JSON.parse(localStorage.getItem('blocked_users') || '[]');
let pendingRequests = {};

// ========== دوال مساعدة ==========
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showError(msg) {
    const errorDiv = document.getElementById('error-msg');
    if (errorDiv) {
        errorDiv.textContent = msg;
        errorDiv.style.display = 'block';
        setTimeout(() => errorDiv.style.display = 'none', 3000);
    }
}

function addSystemMessage(text, containerId = 'chat-messages') {
    const container = document.getElementById(containerId);
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'system-message';
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// ========== دوال الدردشة ==========
function addMessageToChat(message, isOwn, time) {
    const messagesDiv = document.getElementById('chat-messages');
    if (!messagesDiv) return;
    const div = document.createElement('div');
    div.className = 'message ' + (isOwn ? 'own' : '');
    div.innerHTML = `
        <div class="bubble">${escapeHtml(message)}</div>
        <div class="time">${time || new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</div>
    `;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function openChat(username) {
    if (blockedUsers.includes(username)) {
        addSystemMessage(`🚫 لا يمكنك الدردشة مع ${username} لأنه محظور`);
        return;
    }
    currentChatWith = username;
    document.getElementById('conversations-list').style.display = 'none';
    document.getElementById('chat-area').style.display = 'flex';
    document.getElementById('chat-partner-name').textContent = username;
    document.getElementById('chat-messages').innerHTML = '';
    
    const roomId = [currentUser.username, username].sort().join('-');
    const messages = conversations[roomId] || [];
    messages.forEach(msg => {
        addMessageToChat(msg.message, msg.from === currentUser.username, msg.time);
    });
}

function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg || !currentChatWith || !socket) return;
    
    const roomId = [currentUser.username, currentChatWith].sort().join('-');
    socket.emit('send-chat-message', { roomId, message: msg });
    
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
            <div><strong>${escapeHtml(otherUser)}</strong></div>
            <div class="last-msg">${lastMsg ? lastMsg.message.substring(0, 30) : 'ابدأ المحادثة'}</div>
        `;
        div.onclick = () => openChat(otherUser);
        container.appendChild(div);
    });
}

// ========== دوال المنشورات ==========
function addPostToFeed(post) {
    const container = document.getElementById('posts-feed');
    if (!container) return;
    
    const isOwn = post.username === currentUser?.username;
    const postDiv = document.createElement('div');
    postDiv.className = 'post-card';
    postDiv.dataset.id = post.id;
    postDiv.innerHTML = `
        <div class="post-header">
            <div><strong>${escapeHtml(post.displayName)}</strong> <span class="username">@${escapeHtml(post.username)}</span></div>
            <div class="post-time">${new Date(post.time).toLocaleString('ar-EG')}</div>
        </div>
        <div class="post-text">${escapeHtml(post.text)}</div>
        <div class="post-actions">
            <button class="like-btn">❤️ ${post.likes || 0}</button>
            ${isOwn ? '<button class="delete-btn">🗑️ حذف</button>' : ''}
        </div>
    `;
    
    postDiv.querySelector('.like-btn').onclick = () => socket.emit('like-post', post.id);
    if (isOwn) {
        postDiv.querySelector('.delete-btn').onclick = () => socket.emit('delete-post', post.id);
    }
    container.prepend(postDiv);
}

function loadPosts(posts) {
    const container = document.getElementById('posts-feed');
    if (!container) return;
    container.innerHTML = '';
    if (posts.length === 0) {
        container.innerHTML = '<div class="empty-state">لا توجد منشورات</div>';
        return;
    }
    posts.forEach(post => addPostToFeed(post));
}

// ========== دوال المستخدمين ==========
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
            <div>
                <strong>${escapeHtml(user.displayName)}</strong>
                <div class="username">@${escapeHtml(user.username)}</div>
            </div>
            <div class="user-actions" id="actions-${user.username}">
                <button class="request-btn" data-user="${user.username}">💬 طلب صداقة</button>
            </div>
        `;
        
        const requestBtn = div.querySelector('.request-btn');
        requestBtn.onclick = () => {
            if (pendingRequests[user.username]) {
                addSystemMessage('طلب صداقة قيد الانتظار', 'chat-messages');
                return;
            }
            socket.emit('send-request', user.username);
            pendingRequests[user.username] = true;
            requestBtn.textContent = '⏳ جاري...';
            requestBtn.disabled = true;
        };
        container.appendChild(div);
    });
}

function updateUserStatus(username, online) {
    const userCard = document.querySelector(`.user-card[data-username="${username}"]`);
    if (userCard) {
        const statusSpan = userCard.querySelector('.status');
        if (online) statusSpan?.classList.remove('offline');
        else statusSpan?.classList.add('offline');
    }
}

// ========== دوال الملف الشخصي ==========
function updateProfilePage() {
    if (!currentUser) return;
    document.getElementById('profile-name').textContent = currentUser.displayName;
    document.getElementById('profile-username').textContent = `@${currentUser.username}`;
    
    // منشوراتي
    const myPostsContainer = document.getElementById('my-posts');
    if (myPostsContainer) {
        const myPosts = Array.from(document.querySelectorAll('.post-card'))
            .filter(post => post.querySelector('.delete-btn'));
        if (myPosts.length === 0) {
            myPostsContainer.innerHTML = '<div class="empty-state">لا توجد منشورات</div>';
        } else {
            myPostsContainer.innerHTML = '';
            myPosts.forEach(post => myPostsContainer.appendChild(post.cloneNode(true)));
        }
    }
    
    // المحظورين
    const blockedContainer = document.getElementById('blocked-list');
    if (blockedContainer) {
        if (blockedUsers.length === 0) {
            blockedContainer.innerHTML = '<div class="empty-state">لا يوجد محظورين</div>';
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

// ========== التنقل بين الصفحات ==========
function switchToPage(page) {
    document.getElementById('home-page').style.display = page === 'home' ? 'block' : 'none';
    document.getElementById('chat-page').style.display = page === 'chat' ? 'block' : 'none';
    document.getElementById('profile-page').style.display = page === 'profile' ? 'block' : 'none';
    if (page === 'chat') loadConversationsList();
    if (page === 'profile') updateProfilePage();
}

// ========== تسجيل الدخول ==========
function login(username, displayName) {
    socket = io();
    
    socket.on('connect', () => socket.emit('login', { username, displayName }));
    
    socket.on('login-success', (data) => {
        currentUser = { username: data.username, displayName: data.displayName };
        localStorage.setItem('social_user', JSON.stringify(currentUser));
        
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('user-name').textContent = data.displayName;
        document.getElementById('user-username').textContent = `@${data.username}`;
        
        updateUsersList(data.users);
        loadPosts(data.posts);
        updateProfilePage();
        switchToPage('home');
    });
    
    socket.on('login-error', (msg) => showError(msg));
    socket.on('post-added', (post) => addPostToFeed(post));
    socket.on('post-deleted', (id) => document.querySelector(`.post-card[data-id="${id}"]`)?.remove());
    socket.on('user-online', (user) => updateUserStatus(user.username, true));
    socket.on('user-offline', (user) => updateUserStatus(user.username, false));
    
    socket.on('new-request', (data) => {
        const actionsDiv = document.getElementById(`actions-${data.from}`);
        if (actionsDiv) {
            actionsDiv.innerHTML = `
                <button class="accept-btn" data-user="${data.from}">✅ قبول</button>
                <button class="reject-btn" data-user="${data.from}">❌ رفض</button>
            `;
            actionsDiv.querySelector('.accept-btn').onclick = () => socket.emit('accept-request', data.from);
            actionsDiv.querySelector('.reject-btn').onclick = () => socket.emit('reject-request', data.from);
        }
        addSystemMessage(`📩 طلب صداقة جديد من ${data.fromName}`);
    });
    
    socket.on('request-accepted', (data) => {
        addSystemMessage(`🎉 ${data.withName} قبل طلب الصداقة!`);
        delete pendingRequests[data.with];
        loadConversationsList();
    });
    
    socket.on('request-rejected', (data) => {
        addSystemMessage(`😔 تم رفض طلب الصداقة من ${data.by}`);
        delete pendingRequests[data.by];
        const actionsDiv = document.getElementById(`actions-${data.by}`);
        if (actionsDiv) actionsDiv.innerHTML = `<button class="request-btn">💬 طلب صداقة</button>`;
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
        if (currentChatWith === data.from) addMessageToChat(data.message, false, data.time);
        else loadConversationsList();
    });
}

// ========== تشغيل التطبيق ==========
document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('social_user');
    if (saved) {
        try {
            const user = JSON.parse(saved);
            login(user.username, user.displayName);
        } catch(e) {}
    }
    
    document.getElementById('login-btn').onclick = () => {
        const username = document.getElementById('login-username').value.trim().toLowerCase();
        const displayName = document.getElementById('login-displayname').value.trim();
        if (!username || !displayName) return showError('املأ جميع الحقول');
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return showError('يوزر نيم: حروف وأرقام فقط (3-20)');
        login(username, displayName);
    };
    
    document.getElementById('logout-btn').onclick = () => {
        localStorage.removeItem('social_user');
        localStorage.removeItem('conversations');
        location.reload();
    };
    
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.onclick = () => switchToPage(btn.dataset.page);
    });
    
    document.getElementById('post-btn').onclick = () => {
        const text = document.getElementById('post-text').value.trim();
        if (text && socket) socket.emit('new-post', { text });
        document.getElementById('post-text').value = '';
    };
    
    document.getElementById('back-btn').onclick = () => {
        document.getElementById('chat-area').style.display = 'none';
        document.getElementById('conversations-list').style.display = 'block';
        currentChatWith = null;
    };
    
    document.getElementById('block-btn').onclick = () => {
        if (currentChatWith && !blockedUsers.includes(currentChatWith)) {
            blockedUsers.push(currentChatWith);
            localStorage.setItem('blocked_users', JSON.stringify(blockedUsers));
            socket.emit('block-user', currentChatWith);
            document.getElementById('chat-area').style.display = 'none';
            document.getElementById('conversations-list').style.display = 'block';
            currentChatWith = null;
            loadConversationsList();
        }
    };
    
    document.getElementById('send-chat-btn').onclick = sendChatMessage;
    document.getElementById('chat-input').onkeypress = (e) => {
        if (e.key === 'Enter') sendChatMessage();
    };
});
