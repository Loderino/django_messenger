document.addEventListener("DOMContentLoaded", function() {
    // --- ПЕРЕМЕННЫЕ ---
    let currentChatId = null;
    let currentChatType = null;
    let socket = null;
    let currentUser = window.APP_CONFIG.currentUser;
    let nextPageUrl = null;
    let isLoadingHistory = false;
    let isInitialLoad = false;

    let membersNextPageUrl = null;
    let isLoadingMembers = false;

    let currentTab = 'users';
    let searchTimeout = null;
    let selectedUser = null;
    let selectedChatForModal = null;
    let tempReceiverId = null;

    // --- КЭШ ---
    const chatCache = {};

    function getCachedChat(chatId) {
        return chatCache[chatId] || null;
    }

    function setCachedChat(chatId, data) {
        if (!chatCache[chatId]) {
            chatCache[chatId] = { messages: [], nextPageUrl: null, role: null, membersCount: null };
        }
        Object.assign(chatCache[chatId], data);
    }

    // --- DOM ЭЛЕМЕНТЫ ---
    const container = document.getElementById('messages-container');
    const textarea = document.getElementById('message-input');

    const searchContainer = document.getElementById('search-container');
    const searchInput = document.getElementById('global-search-input');
    const searchDropdown = document.getElementById('search-dropdown');
    const searchResults = document.getElementById('search-results');
    const clearSearchBtn = document.getElementById('clear-search');
    const tabUsers = document.getElementById('tab-users');
    const tabChats = document.getElementById('tab-chats');

    const chatInputFooter = document.getElementById('chat-input-footer');
    const chatJoinFooter = document.getElementById('chat-join-footer');
    const joinChatBtn = document.getElementById('join-chat-btn');

    const chatInfoModal = document.getElementById('chat-info-modal');
    const infoAvatar = document.getElementById('info-modal-avatar');
    const infoTitle = document.getElementById('info-modal-title');
    const infoSubtitle = document.getElementById('info-modal-subtitle');
    const infoMembersRow = document.getElementById('info-modal-members-row');
    const infoMembersCount = document.getElementById('info-modal-members-count');
    const infoProfileBtn = document.getElementById('info-modal-profile-btn');
    const infoActionBtn = document.getElementById('info-modal-action-btn');

    const membersModal = document.getElementById('members-modal');
    const membersListContainer = document.getElementById('members-list-container');

    const chatSettingsModal = document.getElementById('chat-settings-modal');
    const settingsAvatar = document.getElementById('settings-avatar');
    const settingsAvatarInput = document.getElementById('settings-avatar-input');
    const settingsTitle = document.getElementById('settings-title');
    const settingsBioText = document.getElementById('settings-bio-text');
    const settingsBioWrapper = document.getElementById('settings-bio-wrapper');
    const editTitleBtn = document.getElementById('edit-chat-title-btn');
    const editDescBtn = document.getElementById('edit-chat-desc-btn');

    let currentChatTitle = '';
    let currentChatDesc = '';

    const createChatModal = document.getElementById('create-chat-modal');
    const newChatTitleInput = document.getElementById('new-chat-title');
    const newChatTypeSelect = document.getElementById('new-chat-type');

    const msgMenu = document.getElementById('message-context-menu');
    const menuRetry = document.getElementById('menu-retry');
    const menuDelete = document.getElementById('menu-delete');
    let selectedMsgElement = null;

    // --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
    function getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }

    function escapeHTML(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function scrollToBottom() {
        container.scrollTop = container.scrollHeight;
    }

    async function fetchWithRetry(url, options = {}, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(url, options);
                if (response.ok) return response;
                if (response.status >= 500) throw new Error("Server Error");
                return response;
            } catch (err) {
                if (i === retries - 1) throw err;
                await new Promise(r => setTimeout(r, 1000 * (i + 1)));
            }
        }
    }

    // --- ЛОГИКА ЧЕРНОВИКОВ ---
    function loadDraft(chatId) {
        const draft = localStorage.getItem(`draft_${chatId}`);
        textarea.value = draft || '';
        textarea.style.height = 'auto';
        if (draft) textarea.style.height = (textarea.scrollHeight) + 'px';
        else textarea.style.height = 'auto';
    }

    textarea.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if (this.scrollHeight > 150) this.style.overflowY = 'auto'; else this.style.overflowY = 'hidden';
        if (currentChatId) localStorage.setItem(`draft_${currentChatId}`, this.value);
        else if (tempReceiverId) localStorage.setItem(`draft_new_${tempReceiverId}`, this.value);
    });

    textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
            e.preventDefault(); sendMessage();
        }
    });

    // --- НЕОТПРАВЛЕННЫЕ СООБЩЕНИЯ ---
    function saveFailedMessage(chatId, msg) {
        let failed = JSON.parse(localStorage.getItem(`failed_${chatId}`) || '[]');
        const failedMsg = { ...msg, is_pending: false, is_failed: true };
        if (!failed.some(m => m.id === msg.id)) {
            failed.push(failedMsg);
            localStorage.setItem(`failed_${chatId}`, JSON.stringify(failed));
        }
    }

    function getFailedMessages(chatId) {
        return JSON.parse(localStorage.getItem(`failed_${chatId}`) || '[]');
    }

    function clearFailedMessage(chatId, msgId) {
        let failed = getFailedMessages(chatId);
        failed = failed.filter(m => m.id !== msgId);
        localStorage.setItem(`failed_${chatId}`, JSON.stringify(failed));
    }

    // --- РАБОТА С ЧАТАМИ ---
    function addChatToList(chat, user) {
        if (document.querySelector(`.chat-item[data-chat-id="${chat.id}"]`)) return;

        const chatList = document.getElementById('chat-list');
        const emptyState = chatList.querySelector('.p-4.text-muted');
        if (emptyState) emptyState.remove();

        const a = document.createElement('a');
        a.href = "#";
        a.className = 'list-group-item list-group-item-action chat-item';
        a.setAttribute('data-chat-id', chat.id);
        a.setAttribute('data-chat-type', chat.type);

        let avatarHtml = '';
        if (chat.avatar_url) {
            avatarHtml = `<img src="${chat.avatar_url}" class="vk-avatar">`;
        } else if (chat.type === 'DIRECT' && user && user.avatar_url) {
            avatarHtml = `<img src="${user.avatar_url}" class="vk-avatar">`;
        } else {
            const titleToShow = chat.display_title || chat.title || '?';
            avatarHtml = `<div class="vk-avatar bg-secondary">${titleToShow[0].toUpperCase()}</div>`;
        }

        a.innerHTML = `
            ${avatarHtml}
            <div class="flex-grow-1 min-w-0">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="fw-bold text-truncate chat-title-text" style="font-size: 15px;">${escapeHTML(chat.display_title || chat.title)}</span>
                </div>
                <small class="text-muted text-truncate d-block" style="font-size: 13px;">
                    ${chat.type === 'DIRECT' ? 'Private dialog' : 'Group chat'}
                </small>
            </div>
        `;

        a.addEventListener('click', function(e) {
            e.preventDefault();
            document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
            this.classList.add('active');
            openChat(this.getAttribute('data-chat-id'), this.querySelector('.chat-title-text').innerText.trim(), this.getAttribute('data-chat-type'), true);
        });

        chatList.insertBefore(a, chatList.firstChild);
    }

    document.querySelectorAll('.chat-item').forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
            this.classList.add('active');
            openChat(this.getAttribute('data-chat-id'), this.querySelector('.chat-title-text').innerText.trim(), this.getAttribute('data-chat-type'), true);
        });
    });

    async function openChat(chatId, chatTitle, chatType, isMember = true) {
        currentChatId = chatId;
        currentChatType = chatType;
        tempReceiverId = null;

        loadDraft(chatId);

        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('active-chat-wrapper').style.display = 'flex';
        document.getElementById('active-chat-title').innerText = chatTitle;

        if (isMember) {
            chatInputFooter.style.display = 'block';
            chatJoinFooter.style.display = 'none';
        } else {
            chatInputFooter.style.display = 'none';
            chatJoinFooter.style.display = 'block';
        }

        const leaveBtn = document.getElementById('leave-chat-btn');
        const settingsBtn = document.getElementById('chat-settings-btn');

        leaveBtn.style.display = (isMember && (chatType === 'GROUP' || chatType === 'CHANNEL' || chatType === 'TOPIC')) ? 'block' : 'none';
        settingsBtn.style.display = 'none';

        let cached = getCachedChat(chatId);

        if (cached && cached.messages.length > 0) {
            nextPageUrl = cached.nextPageUrl;
            container.innerHTML = '';
            cached.messages.forEach(msg => renderMessage(msg));
            scrollToBottom();
        } else {
            container.innerHTML = `
                <div class="skeleton-message"></div>
                <div class="skeleton-message" style="width: 60%;"></div>
                <div class="skeleton-message"></div>
            `;
        }

        const failedMsgs = getFailedMessages(chatId);
        failedMsgs.forEach(msg => renderMessage(msg));
        if (failedMsgs.length > 0) scrollToBottom();

        if (isMember && (chatType === 'GROUP' || chatType === 'CHANNEL' || chatType === 'TOPIC')) {
            if (cached && cached.role) {
                if (cached.role === 'OWNER' || cached.role === 'ADMIN') {
                    settingsBtn.style.display = 'block';
                }
                document.getElementById('active-chat-members-count').innerText = `${cached.membersCount} участников`;
            } else {
                try {
                    const chatRes = await fetchWithRetry(`/api/chats/${chatId}/`);
                    if (currentChatId !== chatId) return;

                    const chatData = await chatRes.json();
                    if (chatData.user_role === 'OWNER' || chatData.user_role === 'ADMIN') {
                        settingsBtn.style.display = 'block';
                    }

                    const count = chatData.members_count || 0;
                    document.getElementById('active-chat-members-count').innerText = `${count} участников`;

                    setCachedChat(chatId, { role: chatData.user_role, membersCount: count });
                } catch (e) {
                    if (currentChatId !== chatId) return;
                    console.error(e);
                    document.getElementById('active-chat-members-count').innerText = '';
                }
            }
        } else if (!isMember && chatType !== 'DIRECT') {
             try {
                const chatRes = await fetchWithRetry(`/api/chats/${chatId}/`);
                if (currentChatId !== chatId) return;
                const chatData = await chatRes.json();
                const count = chatData.members_count || 0;
                document.getElementById('active-chat-members-count').innerText = `${count} участников`;
            } catch (e) {
                console.error(e);
            }
        } else {
            document.getElementById('active-chat-members-count').innerText = '';
        }

        if (!cached || cached.messages.length === 0) {
            isInitialLoad = true;
            try {
                const response = await fetchWithRetry(`/api/chats/${chatId}/messages/`);
                if (!response.ok) throw new Error("Ошибка загрузки");
                if (currentChatId !== chatId) return;

                const data = await response.json();
                nextPageUrl = data.next;
                const messages = data.results ? [...data.results].reverse() : [...data].reverse();

                setCachedChat(chatId, { messages: messages, nextPageUrl: nextPageUrl });

                container.innerHTML = '';
                messages.forEach(msg => renderMessage(msg));
                getFailedMessages(chatId).forEach(msg => renderMessage(msg));

                scrollToBottom();
                isInitialLoad = false;
            } catch (error) {
                if (currentChatId !== chatId) return;
                container.innerHTML = `<div class="text-danger text-center mt-4 w-100">${error.message}</div>`;
            }
        }
    }

    function startNewChatLocally(user) {
        currentChatId = null;
        currentChatType = 'DIRECT';
        tempReceiverId = user.id;

        loadDraft('new_' + user.id);

        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('active-chat-wrapper').style.display = 'flex';
        document.getElementById('active-chat-title').innerText = user.display_name;
        document.getElementById('active-chat-members-count').innerText = '';

        chatInputFooter.style.display = 'block';
        chatJoinFooter.style.display = 'none';

        document.getElementById('leave-chat-btn').style.display = 'none';
        document.getElementById('chat-settings-btn').style.display = 'none';

        container.innerHTML = '<div class="text-center text-muted mt-4">Напишите первое сообщение...</div>';

        document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
    }

    async function leaveChat() {
        if (!currentChatId || !confirm("Вы уверены, что хотите выйти из этого чата?")) return;

        try {
            const response = await fetchWithRetry(`/api/chats/${currentChatId}/leave/`, {
                method: 'POST',
                headers: { 'X-CSRFToken': getCookie('csrftoken') }
            });

            if (response.ok || response.status === 204) {
                const chatItem = document.querySelector(`.chat-item[data-chat-id="${currentChatId}"]`);
                if (chatItem) chatItem.remove();

                delete chatCache[currentChatId];
                localStorage.removeItem(`draft_${currentChatId}`);
                localStorage.removeItem(`failed_${currentChatId}`);

                currentChatId = null;
                currentChatType = null;
                document.getElementById('active-chat-wrapper').style.display = 'none';
                document.getElementById('empty-state').style.display = 'flex';
            } else {
                const err = await response.json();
                alert(err.detail || "Не удалось выйти из чата");
            }
        } catch (error) {
            console.error(error);
        }
    }

    joinChatBtn.addEventListener('click', async () => {
        if (!currentChatId) return;

        try {
            const response = await fetchWithRetry(`/api/chats/${currentChatId}/join/`, {
                method: 'POST',
                headers: { 'X-CSRFToken': getCookie('csrftoken') }
            });

            if (response.ok || response.status === 400) {
                const chatRes = await fetchWithRetry(`/api/chats/${currentChatId}/`);
                const chatData = await chatRes.json();

                const fakeUser = { display_name: chatData.title ? chatData.title[0] : 'G', avatar_url: null };
                addChatToList(chatData, fakeUser);

                openChat(currentChatId, chatData.display_title || chatData.title, chatData.type, true);
            } else {
                alert("Не удалось вступить в чат");
            }
        } catch (e) {
            console.error(e);
        }
    });

    container.addEventListener('scroll', async function() {
        if (container.scrollTop === 0 && nextPageUrl && !isLoadingHistory && !isInitialLoad) {
            isLoadingHistory = true;
            const oldScrollHeight = container.scrollHeight;

            const skeleton = document.createElement('div');
            skeleton.innerHTML = `<div class="skeleton-message"></div><div class="skeleton-message" style="width: 50%;"></div>`;
            container.prepend(skeleton);

            try {
                const response = await fetchWithRetry(nextPageUrl);
                if (currentChatId !== currentChatId) return;

                const data = await response.json();
                nextPageUrl = data.next;
                const messages = [...data.results].reverse();

                if (chatCache[currentChatId]) {
                    chatCache[currentChatId].messages = [...messages, ...chatCache[currentChatId].messages];
                    chatCache[currentChatId].nextPageUrl = nextPageUrl;
                }

                skeleton.remove();

                const fragment = document.createDocumentFragment();
                messages.forEach(msg => {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = createMessageHTML(msg).trim();
                    fragment.appendChild(tempDiv.firstChild);
                });

                container.insertBefore(fragment, container.firstChild);
                container.scrollTop = container.scrollHeight - oldScrollHeight;
            } catch (error) {
                console.error("Ошибка загрузки истории", error);
                skeleton.remove();
            } finally {
                isLoadingHistory = false;
            }
        }
    });

    function createMessageHTML(msg) {
        const time = new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        let rowClass = '';
        let statusIcon = '';

        if (msg.is_pending) {
            rowClass = 'msg-pending';
            statusIcon = '<span class="spinner"></span>';
        } else if (msg.is_failed) {
            rowClass = 'msg-failed';
            statusIcon = '<i class="bi bi-exclamation-circle-fill text-danger" style="margin-left: 5px;"></i>';
        }

        let avatarUrl = msg.sender_avatar;
        if (msg.is_pending || msg.is_failed) {
            avatarUrl = window.APP_CONFIG.currentUserAvatar || "/static/images/avatars/default.png";
        }

        const profileUrl = (msg.is_pending || msg.is_failed) ? '#' : `/user/${msg.sender}/`;

        const avatarTag = (msg.is_pending || msg.is_failed)
            ? `<img src="${avatarUrl}" class="message-avatar">`
            : `<a href="${profileUrl}"><img src="${avatarUrl}" class="message-avatar"></a>`;

        const nameTag = (msg.is_pending || msg.is_failed)
            ? `<span class="message-author">${escapeHTML(msg.sender_name)}</span>`
            : `<a href="${profileUrl}" target="_blank" rel="noopener noreferrer" class="message-author" style="text-decoration: none;">${escapeHTML(msg.sender_name)}</a>`;

        return `
            <div class="message-row ${rowClass}" id="msg-${msg.id}">
                ${avatarTag}
                <div class="message-content">
                    <div class="message-header">${nameTag}</div>
                    <div class="message-body">
                        <span class="message-text">${escapeHTML(msg.text)}</span>
                        <span class="message-time">${time} ${statusIcon}</span>
                    </div>
                </div>
            </div>
        `;
    }

    function renderMessage(msg) {
        container.insertAdjacentHTML('beforeend', createMessageHTML(msg));
    }

    async function sendMessage(textToSend = null) {
        const text = textToSend || textarea.value.trim();
        if (!text) return;

        if (!currentChatId && tempReceiverId) {
            const tempId = 'temp_' + Date.now();
            const tempMessage = {
                id: tempId,
                text: text,
                sender_name: currentUser,
                sender_avatar: window.APP_CONFIG.currentUserAvatar,
                created_at: new Date().toISOString(),
                is_pending: true
            };

            container.innerHTML = '';
            renderMessage(tempMessage);
            scrollToBottom();

            textarea.value = '';
            textarea.style.height = 'auto';
            localStorage.removeItem(`draft_new_${tempReceiverId}`);

            try {
                const chatRes = await fetchWithRetry('/api/chats/direct/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCookie('csrftoken')
                    },
                    body: JSON.stringify({ user_id: tempReceiverId })
                });

                if (!chatRes.ok) throw new Error("Ошибка создания чата");
                const chatData = await chatRes.json();
                currentChatId = chatData.id;

                const msgRes = await fetchWithRetry('/api/messages/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCookie('csrftoken')
                    },
                    body: JSON.stringify({ chat: currentChatId, text: text })
                });

                if (!msgRes.ok) throw new Error("Ошибка отправки");

                const fakeUser = { display_name: chatData.display_title, avatar_url: chatData.avatar_url };
                addChatToList(chatData, fakeUser);

                const newChatItem = document.querySelector(`.chat-item[data-chat-id="${currentChatId}"]`);
                if (newChatItem) newChatItem.classList.add('active');

                tempReceiverId = null;

                const tempEl = document.getElementById(`msg-${tempId}`);
                if (tempEl) tempEl.remove();

                openChat(currentChatId, chatData.display_title, chatData.type, true);

            } catch (error) {
                console.error(error);
                const tempEl = document.getElementById(`msg-${tempId}`);
                if (tempEl) {
                    tempEl.classList.add('msg-failed');
                    tempEl.classList.remove('msg-pending');
                }
                alert("Не удалось отправить сообщение");
            }
            return;
        }

        if (!currentChatId) return;

        if (!textToSend) {
            textarea.value = '';
            textarea.style.height = 'auto';
            localStorage.removeItem(`draft_${currentChatId}`);
        }

        const tempId = 'temp_' + Date.now();
        const tempMessage = {
            id: tempId,
            text: text,
            sender_name: currentUser,
            sender_avatar: window.APP_CONFIG.currentUserAvatar,
            created_at: new Date().toISOString(),
            is_pending: true
        };

        renderMessage(tempMessage);
        scrollToBottom();

        try {
            const response = await fetchWithRetry('/api/messages/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken')
                },
                body: JSON.stringify({ chat: currentChatId, text: text })
            });

            if (response.ok) {
                const data = await response.json();
                const message = {
                    id: data.id,
                    text: text,
                    sender_name: currentUser,
                    sender_avatar: window.APP_CONFIG.currentUserAvatar,
                    created_at: new Date().toISOString(),
                    is_pending: false
                };

                const tempEl = document.getElementById(`msg-${tempId}`);
                if (tempEl) tempEl.remove();

                if (!document.getElementById(`msg-${message.id}`)) {
                    renderMessage(message);
                    scrollToBottom();
                }

                if (chatCache[currentChatId]) {
                    const exists = chatCache[currentChatId].messages.some(m => m.id === message.id);
                    if (!exists) chatCache[currentChatId].messages.push(message);
                }
            } else {
                throw new Error("Ошибка отправки");
            }
        } catch (error) {
            const tempEl = document.getElementById(`msg-${tempId}`);
            if (tempEl) {
                tempEl.classList.add('msg-failed');
                tempEl.classList.remove('msg-pending');
                const timeSpan = tempEl.querySelector('.message-time');
                if (timeSpan) {
                    timeSpan.innerHTML = `${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} <i class="bi bi-exclamation-circle-fill text-danger" style="margin-left: 5px;"></i>`;
                }
            }
            saveFailedMessage(currentChatId, tempMessage);
        }
    }

    document.getElementById('send-btn').addEventListener('click', () => sendMessage());

    // --- WEBSOCKET ---
    function connectGlobalWebSocket() {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        socket = new WebSocket(`${wsProtocol}${window.location.host}/ws/user/`);

        socket.onopen = function(e) {
            console.log("Глобальный WebSocket подключен");
        };

        socket.onmessage = function(e) {
            const data = JSON.parse(e.data);

            if (data.type === 'chat.message.new') {
                const chatId = data.payload.chat.id;
                if (chatCache[chatId]) chatCache[chatId].messages.push(data.payload.message);

                if (chatId == currentChatId && data.payload.message.sender_name !== currentUser) {
                    const isScrolledToBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
                    renderMessage(data.payload.message);
                    if (isScrolledToBottom) scrollToBottom();
                }
            }
            else if (data.type === 'chat.state.updated') {
                const chatData = data.payload.chat;
                const chatId = chatData.id;

                const chatItem = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
                if (chatItem) {
                    if (chatData.title) {
                        const titleEl = chatItem.querySelector('.chat-title-text');
                        if (titleEl) titleEl.innerText = chatData.title;
                    }
                    if (chatData.avatar_url) {
                        const avatarEl = chatItem.querySelector('.vk-avatar');
                        if (avatarEl) {
                            const img = document.createElement('img');
                            img.src = chatData.avatar_url + "?t=" + Date.now();
                            img.className = 'vk-avatar';
                            avatarEl.replaceWith(img);
                        }
                    }
                }

                if (chatId == currentChatId) {
                    if (chatData.title) document.getElementById('active-chat-title').innerText = chatData.title;
                }
            }
            else if (data.type === 'chat.direct.created') {
                addChatToList(data.payload.chat, data.payload.user);
            }
            else if (data.type === 'chat.member.joined' || data.type === 'chat.member.left') {
                const chatId = data.payload.chat.id;

                if (chatCache[chatId] && chatCache[chatId].membersCount !== null) {
                    if (data.type === 'chat.member.joined') chatCache[chatId].membersCount += 1;
                    else chatCache[chatId].membersCount -= 1;
                }

                if (chatId == currentChatId) {
                    const cached = getCachedChat(chatId);
                    if (cached && cached.membersCount !== null) {
                        document.getElementById('active-chat-members-count').innerText = `${cached.membersCount} участников`;
                    }
                }
            }
            else if (data.type === 'chat.state.deleted') {
                const deletedChatId = data.payload.chat_id;
                const chatItem = document.querySelector(`.chat-item[data-chat-id="${deletedChatId}"]`);
                if (chatItem) chatItem.remove();

                delete chatCache[deletedChatId];
                localStorage.removeItem(`draft_${deletedChatId}`);
                localStorage.removeItem(`failed_${deletedChatId}`);

                if (currentChatId == deletedChatId) {
                    currentChatId = null;
                    currentChatType = null;
                    document.getElementById('active-chat-wrapper').style.display = 'none';
                    document.getElementById('empty-state').style.display = 'flex';
                }
            }
        };

        socket.onclose = function(e) {
            console.log("WebSocket отключен. Переподключение...");
            setTimeout(connectGlobalWebSocket, 3000);
        };
    }

    connectGlobalWebSocket();

    // --- КОНТЕКСТНОЕ МЕНЮ ДЛЯ СООБЩЕНИЙ ---
    container.addEventListener('click', function(e) {
        const messageRow = e.target.closest('.message-row');
        if (!messageRow || !messageRow.classList.contains('msg-failed')) {
            msgMenu.style.display = 'none';
            return;
        }
        e.preventDefault();
        selectedMsgElement = messageRow;
        const rect = messageRow.getBoundingClientRect();
        let topPos = rect.bottom + window.scrollY;
        if (rect.bottom + 100 > window.innerHeight) topPos = rect.top + window.scrollY - 100;
        msgMenu.style.top = `${topPos}px`;
        msgMenu.style.left = `${rect.left + window.scrollX + 20}px`;
        msgMenu.style.display = 'block';
        menuRetry.style.display = 'block';
    });

    document.addEventListener('click', function(e) {
        if (!msgMenu.contains(e.target) && !e.target.closest('.message-row.msg-failed')) {
            msgMenu.style.display = 'none';
        }
    });

    menuRetry.addEventListener('click', function() {
        if (!selectedMsgElement) return;
        const text = selectedMsgElement.querySelector('.message-text').innerText;
        const msgId = selectedMsgElement.id.replace('msg-', '');
        clearFailedMessage(currentChatId, msgId);
        selectedMsgElement.remove();
        msgMenu.style.display = 'none';
        sendMessage(text);
    });

    menuDelete.addEventListener('click', function() {
        if (!selectedMsgElement) return;
        const msgId = selectedMsgElement.id.replace('msg-', '');
        clearFailedMessage(currentChatId, msgId);
        selectedMsgElement.remove();
        msgMenu.style.display = 'none';
    });

    // --- ВСТРОЕННЫЙ ПОИСК ---
    searchInput.addEventListener('focus', () => {
        clearSearchBtn.style.opacity = '1';
        searchDropdown.style.display = 'flex';
        if (searchInput.value.trim().length < 2) {
            searchResults.innerHTML = '<div class="text-center text-muted mt-4">Начните вводить имя...</div>';
        }
    });

    searchInput.addEventListener('blur', () => {
        setTimeout(() => {
            if (!searchContainer.contains(document.activeElement)) {
                clearSearchBtn.style.opacity = '0';
            }
        }, 100);
    });

    document.addEventListener('click', (e) => {
        const isClickInsideSearch = searchContainer.contains(e.target);
        const isClickInsideModal = chatInfoModal.contains(e.target) ||
                                   membersModal.contains(e.target) ||
                                   createChatModal.contains(e.target) ||
                                   chatSettingsModal.contains(e.target);

        if (!isClickInsideSearch && !isClickInsideModal) {
            closeSearch();
        }
    });

    function closeSearch() {
        searchDropdown.style.display = 'none';
        searchInput.value = '';
        clearSearchBtn.style.opacity = '0';
        searchResults.innerHTML = '';
        searchInput.blur();
    }

    clearSearchBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        closeSearch();
    });

    function switchSearchTab(tab) {
        currentTab = tab;
        tabUsers.classList.toggle('active', tab === 'users');
        tabChats.classList.toggle('active', tab === 'chats');
        performSearch();
    }

    searchInput.addEventListener('input', function() {
        clearTimeout(searchTimeout);
        const query = this.value.trim();
        if (query.length < 2) {
            searchResults.innerHTML = '<div class="text-center text-muted mt-4">Введите хотя бы 2 символа...</div>';
            return;
        }
        searchTimeout = setTimeout(performSearch, 300);
    });

    async function performSearch() {
        const query = searchInput.value.trim();
        if (query.length < 2) return;
        searchResults.innerHTML = '<div class="text-center text-muted mt-4">Поиск...</div>';

        try {
            if (currentTab === 'users') {
                const res = await fetchWithRetry(`/api/users/search/?q=${encodeURIComponent(query)}`);
                const users = await res.json();
                renderUsers(users);
            } else {
                const res = await fetchWithRetry(`/api/chats/search/?q=${encodeURIComponent(query)}`);
                const chats = await res.json();
                renderChats(chats);
            }
        } catch (error) {
            searchResults.innerHTML = '<div class="text-danger text-center mt-4">Ошибка поиска</div>';
        }
    }

    function renderUsers(users) {
        searchResults.innerHTML = '';
        if (users.length === 0) {
            searchResults.innerHTML = '<div class="text-center text-muted mt-4">Люди не найдены</div>';
            return;
        }

        users.forEach(user => {
            const div = document.createElement('div');
            div.className = 'list-group-item';
            div.style.cursor = 'pointer';
            const safeName = escapeHTML(user.display_name);
            div.innerHTML = `
                <img src="${user.avatar_url}" class="vk-avatar" style="width: 36px; height: 36px;">
                <div>
                    <div class="fw-bold">${safeName}</div>
                    <small class="text-muted">@${safeName}</small>
                </div>
            `;
            div.onclick = () => openUserProfileModal(user);
            searchResults.appendChild(div);
        });
    }

    function renderChats(chats) {
        searchResults.innerHTML = '';
        if (chats.length === 0) {
            searchResults.innerHTML = '<div class="text-center text-muted mt-4">Чаты не найдены</div>';
            return;
        }

        chats.forEach(chat => {
            const div = document.createElement('div');
            div.className = 'list-group-item';
            div.style.cursor = 'pointer';
            const titleToShow = escapeHTML(chat.display_title || chat.title);

            let avatarHtml = '';
            if (chat.avatar_url) {
                avatarHtml = `<img src="${chat.avatar_url}" class="vk-avatar" style="width: 36px; height: 36px;">`;
            } else {
                avatarHtml = `<div class="vk-avatar bg-secondary" style="width: 36px; height: 36px; font-size: 14px;">${titleToShow[0].toUpperCase()}</div>`;
            }

            div.innerHTML = `
                ${avatarHtml}
                <div>
                    <div class="fw-bold">${titleToShow}</div>
                    <small class="text-muted">${escapeHTML(chat.type)}</small>
                </div>
            `;
            div.onclick = () => {
                closeSearch();
                if (chat.is_member) {
                    const chatItem = document.querySelector(`.chat-item[data-chat-id="${chat.id}"]`);
                    if (chatItem) chatItem.click();
                    else openChat(chat.id, titleToShow, chat.type, true);
                } else {
                    openChat(chat.id, titleToShow, chat.type, false);
                }
            };
            searchResults.appendChild(div);
        });
    }

    // --- ЛОГИКА НОВЫХ МОДАЛОК ---

    // Открытие профиля из поиска (ЛС)
    function openUserProfileModal(user) {
        infoAvatar.innerHTML = `<img src="${user.avatar_url}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px;">`;
        infoTitle.innerText = user.display_name;
        infoSubtitle.innerText = `@${user.display_name}`;

        document.getElementById('info-modal-id').innerText = user.id;
        document.getElementById('info-modal-description-block').style.display = 'none';
        infoMembersRow.style.display = 'none';

        const bioBlock = document.getElementById('info-modal-bio-block');
        const bioText = document.getElementById('info-modal-bio');
        if (user.bio) {
            bioBlock.style.display = 'block';
            bioText.innerText = user.bio;
        } else {
            bioBlock.style.display = 'block';
            bioText.innerText = "Пользователь пока ничего не рассказал о себе.";
        }

        infoProfileBtn.style.display = 'block';
        infoProfileBtn.onclick = () => window.open(`/user/${user.display_name}/`, '_blank');

        // Умная кнопка
        let hasChat = false;
        let existingChatId = null;

        document.querySelectorAll('.chat-item[data-chat-type="DIRECT"]').forEach(item => {
            if (item.querySelector('.chat-title-text').innerText.trim() === user.display_name) {
                hasChat = true;
                existingChatId = item.getAttribute('data-chat-id');
            }
        });

        infoActionBtn.style.display = 'block';
        if (hasChat) {
            infoActionBtn.innerText = "Перейти в чат";
            infoActionBtn.style.backgroundColor = 'var(--vk-blue)';
            infoActionBtn.onclick = () => {
                chatInfoModal.style.display = 'none';
                closeSearch();
                const chatItem = document.querySelector(`.chat-item[data-chat-id="${existingChatId}"]`);
                if (chatItem) chatItem.click();
            };
        } else {
            infoActionBtn.innerText = "Написать сообщение";
            infoActionBtn.style.backgroundColor = '#36638e';
            infoActionBtn.onclick = () => {
                chatInfoModal.style.display = 'none';
                closeSearch();
                startNewChatLocally(user);
            };
        }

        chatInfoModal.style.display = 'flex';
    }

    // Открытие модалки по клику на шапку чата
    document.getElementById('active-chat-header').addEventListener('click', async function(e) {
        if (e.target.closest('#leave-chat-btn') || e.target.closest('#chat-settings-btn')) return;
        if (!currentChatId) return;

        try {
            const res = await fetchWithRetry(`/api/chats/${currentChatId}/`);
            const chatData = await res.json();

            // 1. СБРОС ВСЕХ БЛОКОВ
            document.getElementById('info-modal-description-block').style.display = 'none';
            document.getElementById('info-modal-bio-block').style.display = 'none';
            infoMembersRow.style.display = 'none';
            infoProfileBtn.style.display = 'none';
            infoActionBtn.style.display = 'none';
            document.getElementById('info-modal-id').innerText = '';
            document.getElementById('info-modal-members-count').innerText = '';

            const titleToShow = chatData.display_title || chatData.title || '?';
            if (chatData.avatar_url) {
                infoAvatar.innerHTML = `<img src="${chatData.avatar_url}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px;">`;
            } else {
                infoAvatar.innerHTML = `<div style="width: 100%; height: 100%; background: var(--vk-blue); border-radius: 4px; display:flex; justify-content:center; align-items:center; font-size:32px;">${titleToShow[0].toUpperCase()}</div>`;
            }

            infoTitle.innerText = titleToShow;
            infoSubtitle.innerText = chatData.type === 'DIRECT' ? 'Личный диалог' : (chatData.type === 'GROUP' ? 'Группа' : (chatData.type === 'CHANNEL' ? 'Канал' : 'Топик'));

            if (chatData.type === 'DIRECT') {
                // ================= ЛОГИКА ДЛЯ ЛС =================
                infoMembersRow.style.display = 'none';
                document.getElementById('info-modal-description-block').style.display = 'none';

                const mRes = await fetchWithRetry(`/api/chats/${currentChatId}/members/`);
                const mData = await mRes.json();
                const members = mData.results || mData;

                const peer = members.find(m => m.display_name !== currentUser) || members[0];

                if (peer) {
                    const uRes = await fetchWithRetry(`/api/users/${peer.user}/`);
                    const uData = await uRes.json();

                    infoTitle.innerText = uData.display_name;
                    infoSubtitle.innerText = `@${uData.display_name}`;
                    document.getElementById('info-modal-id').innerText = uData.id;

                    if (uData.avatar_url) {
                        infoAvatar.innerHTML = `<img src="${uData.avatar_url}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px;">`;
                    }

                    const bioBlock = document.getElementById('info-modal-bio-block');
                    const bioText = document.getElementById('info-modal-bio');
                    bioBlock.style.display = 'block';
                    bioText.innerText = uData.bio || "Пользователь пока ничего не рассказал о себе.";

                    infoProfileBtn.style.display = 'block';
                    infoProfileBtn.onclick = () => {
                        window.open(`/user/${uData.display_name}/`, '_blank');
                    };
                }
            } else {
                // ================= ЛОГИКА ДЛЯ ГРУПП / КАНАЛОВ =================
                document.getElementById('info-modal-id').innerText = chatData.id;

                const descBlock = document.getElementById('info-modal-description-block');
                const descText = document.getElementById('info-modal-description');
                if (chatData.description) {
                    descBlock.style.display = 'block';
                    descText.innerText = chatData.description;
                }

                if (chatData.type !== 'CHANNEL') {
                    // Группа или Топик — кликабельно
                    infoMembersRow.style.display = 'flex';
                    infoMembersRow.style.cursor = 'pointer';
                    document.getElementById('info-modal-members-arrow').style.display = 'block';

                    const count = chatData.members_count || 0;
                    document.getElementById('info-modal-members-count').innerText = `${count} участников`;

                    infoMembersRow.onmouseenter = () => infoMembersRow.style.background = 'var(--vk-border)';
                    infoMembersRow.onmouseleave = () => infoMembersRow.style.background = 'var(--active-chat-bg)';

                    infoMembersRow.onclick = () => {
                        openMembersModal(currentChatId, count);
                    };
                } else {
                    // Канал — НЕ кликабельно
                    infoMembersRow.style.display = 'flex';
                    infoMembersRow.style.cursor = 'default';
                    document.getElementById('info-modal-members-arrow').style.display = 'none';

                    const count = chatData.members_count || 0;
                    document.getElementById('info-modal-members-count').innerText = `${count} участников`;

                    infoMembersRow.onmouseenter = null;
                    infoMembersRow.onmouseleave = null;
                    infoMembersRow.onclick = null;
                    infoMembersRow.style.background = 'var(--active-chat-bg)';
                }
            }

            chatInfoModal.style.display = 'flex';

        } catch (err) {
            console.error(err);
        }
    });

    // --- СПИСОК УЧАСТНИКОВ С ПАГИНАЦИЕЙ ---

    async function loadMembersPage(url, append = false) {
        try {
            const res = await fetchWithRetry(url);
            const data = await res.json();
            const members = data.results || data;

            if (data.next !== undefined) {
                membersNextPageUrl = data.next;
            } else {
                membersNextPageUrl = null;
            }

            if (!append) {
                membersListContainer.innerHTML = '';
            }

            members.forEach(m => {
                const div = document.createElement('div');
                div.className = 'member-item';

                let roleHtml = '';
                if (m.role === 'OWNER') {
                    roleHtml = `<div class="member-role owner">Владелец</div>`;
                } else if (m.role === 'ADMIN') {
                    roleHtml = `<div class="member-role admin">Админ</div>`;
                }

                const nameToShow = m.display_name || m.username || 'Пользователь';

                div.innerHTML = `
                    <a href="/user/${m.user}/" target="_blank" style="text-decoration: none; color: inherit; display: flex; align-items: center; gap: 12px; width: 100%;">
                        <img src="${m.avatar_url}" class="member-avatar">
                        <div>
                            <div class="fw-bold" style="font-size: 14px; color: var(--text-main); margin-bottom: 2px;">${escapeHTML(nameToShow)}</div>
                            ${roleHtml}
                        </div>
                    </a>
                `;
                membersListContainer.appendChild(div);
            });
        } catch (err) {
            console.error("Ошибка загрузки участников", err);
        } finally {
            isLoadingMembers = false;
        }
    }

    // Открытие списка участников
    async function openMembersModal(chatId, totalCount) {
        membersListContainer.innerHTML = '<div class="text-center text-muted mt-4">Загрузка...</div>';
        membersModal.style.display = 'flex';
        membersNextPageUrl = null;
        isLoadingMembers = false;

        await loadMembersPage(`/api/chats/${chatId}/members/`);

        // Обработчик скролла для пагинации
        membersListContainer.onscroll = async function() {
            if (membersListContainer.scrollTop + membersListContainer.clientHeight >= membersListContainer.scrollHeight - 20) {
                if (membersNextPageUrl && !isLoadingMembers) {
                    isLoadingMembers = true;

                    const loader = document.createElement('div');
                    loader.className = 'text-center text-muted my-2';
                    loader.innerText = 'Загрузка...';
                    membersListContainer.appendChild(loader);

                    await loadMembersPage(membersNextPageUrl, true);

                    if (loader.parentNode) {
                        loader.remove();
                    }
                }
            }
        };
    }

    // Закрытие модалок
    document.getElementById('close-info-modal-btn').addEventListener('click', () => {
        chatInfoModal.style.display = 'none';
    });
    document.getElementById('close-members-modal-btn').addEventListener('click', () => {
        membersModal.style.display = 'none';
        membersListContainer.onscroll = null;
    });
    chatInfoModal.addEventListener('click', (e) => { if (e.target === chatInfoModal) chatInfoModal.style.display = 'none'; });
    membersModal.addEventListener('click', (e) => { if (e.target === membersModal) membersModal.style.display = 'none'; });

    // --- НАСТРОЙКИ ЧАТА ---
    async function openChatSettings() {
        if (!currentChatId) return;
        chatSettingsModal.style.display = 'flex';

        try {
            const res = await fetchWithRetry(`/api/chats/${currentChatId}/`);
            const data = await res.json();

            currentChatTitle = data.title || 'Без названия';
            currentChatDesc = data.description || '';

            settingsTitle.innerText = currentChatTitle;
            document.getElementById('settings-type').innerText = data.type === 'CHANNEL' ? 'Канал' : 'Группа';

            if (data.avatar_url) {
                settingsAvatar.innerHTML = `<img src="${data.avatar_url}" alt="avatar">`;
            } else {
                settingsAvatar.innerHTML = currentChatTitle[0].toUpperCase();
            }

            settingsBioText.innerText = currentChatDesc || 'Добавьте описание...';
            settingsBioText.style.color = currentChatDesc ? 'var(--text-main)' : 'var(--text-muted)';

        } catch (e) {
            console.error("Ошибка загрузки настроек", e);
        }
    }

    function closeChatSettings() {
        chatSettingsModal.style.display = 'none';
    }

    chatSettingsModal.addEventListener('click', (e) => {
        if (e.target === chatSettingsModal) closeChatSettings();
    });

    async function patchChat(data) {
        const formData = new FormData();
        for (const key in data) {
            formData.append(key, data[key]);
        }

        try {
            const res = await fetchWithRetry(`/api/chats/${currentChatId}/`, {
                method: 'PATCH',
                headers: { 'X-CSRFToken': getCookie('csrftoken') },
                body: formData
            });
            if (!res.ok) throw new Error("Ошибка API");
            return await res.json();
        } catch (error) {
            console.error(error);
            alert("Не удалось сохранить изменения");
            return null;
        }
    }

    editTitleBtn.addEventListener('click', () => {
        if (document.getElementById('inline-title-input')) return;
        settingsTitle.style.display = 'none';
        editTitleBtn.style.display = 'none';

        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'inline-title-input';
        input.className = 'inline-input';
        input.value = currentChatTitle;
        input.maxLength = 100;
        settingsTitle.parentElement.insertBefore(input, settingsTitle);
        input.focus();

        const save = async () => {
            const newVal = input.value.trim();
            if (newVal && newVal !== currentChatTitle) {
                const result = await patchChat({ title: newVal });
                if (result) {
                    currentChatTitle = result.title;
                    settingsTitle.innerText = currentChatTitle;
                }
            }
            settingsTitle.style.display = 'inline-block';
            editTitleBtn.style.display = 'inline-block';
            input.remove();
        };

        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') {
                input.value = currentChatTitle;
                input.removeEventListener('blur', save);
                input.blur();
            }
        });
    });

    editDescBtn.addEventListener('click', () => {
        if (document.getElementById('inline-desc-input')) return;
        settingsBioText.style.display = 'none';
        editDescBtn.style.display = 'none';

        const textarea = document.createElement('textarea');
        textarea.id = 'inline-desc-input';
        textarea.className = 'inline-input textarea';
        textarea.value = currentChatDesc;
        textarea.maxLength = 1024;
        settingsBioWrapper.appendChild(textarea);
        textarea.focus();

        const save = async () => {
            const newVal = textarea.value.trim();
            if (newVal !== currentChatDesc) {
                const result = await patchChat({ description: newVal });
                if (result) {
                    currentChatDesc = result.description || '';
                    settingsBioText.innerText = currentChatDesc || 'Добавьте описание...';
                    settingsBioText.style.color = currentChatDesc ? 'var(--text-main)' : 'var(--text-muted)';
                }
            }
            settingsBioText.style.display = 'block';
            editDescBtn.style.display = 'inline-block';
            textarea.remove();
        };

        textarea.addEventListener('blur', save);
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) textarea.blur();
            if (e.key === 'Escape') {
                textarea.value = currentChatDesc;
                textarea.removeEventListener('blur', save);
                textarea.blur();
            }
        });
    });

    document.getElementById('settings-avatar-container').addEventListener('click', () => settingsAvatarInput.click());

    settingsAvatarInput.addEventListener('change', async () => {
        if (!settingsAvatarInput.files.length) return;

        const result = await patchChat({ avatar: settingsAvatarInput.files[0] });
        if (result && result.avatar_url) {
            settingsAvatar.innerHTML = `<img src="${result.avatar_url}?t=${Date.now()}" alt="avatar">`;
        }
        settingsAvatarInput.value = '';
    });


    // --- УДАЛЕНИЕ ЧАТА ---
    async function deleteCurrentChat() {
        if (!currentChatId || !confirm("Вы уверены, что хотите УДАЛИТЬ этот чат? Это действие необратимо.")) return;

        try {
            const response = await fetchWithRetry(`/api/chats/${currentChatId}/`, {
                method: 'DELETE',
                headers: { 'X-CSRFToken': getCookie('csrftoken') }
            });

            if (response.ok || response.status === 204) {
                closeChatSettings();
                const chatItem = document.querySelector(`.chat-item[data-chat-id="${currentChatId}"]`);
                if (chatItem) chatItem.remove();

                delete chatCache[currentChatId];
                localStorage.removeItem(`draft_${currentChatId}`);
                localStorage.removeItem(`failed_${currentChatId}`);

                currentChatId = null;
                currentChatType = null;
                document.getElementById('active-chat-wrapper').style.display = 'none';
                document.getElementById('empty-state').style.display = 'flex';
            } else {
                alert("Не удалось удалить чат. Возможно, у вас нет прав.");
            }
        } catch (error) {
            console.error(error);
        }
    }

    // --- СОЗДАНИЕ ЧАТА ---
    document.getElementById('open-create-chat-btn').addEventListener('click', () => {
        newChatTitleInput.value = '';
        newChatTypeSelect.value = 'GROUP';
        createChatModal.style.display = 'flex';
        newChatTitleInput.focus();
    });

    function closeCreateChatModal() {
        createChatModal.style.display = 'none';
    }

    createChatModal.addEventListener('click', (e) => {
        if (e.target === createChatModal) closeCreateChatModal();
    });

    async function submitCreateChat() {
        const title = newChatTitleInput.value.trim();
        const type = newChatTypeSelect.value;

        if (!title) {
            alert("Введите название чата");
            return;
        }

        try {
            const response = await fetchWithRetry('/api/chats/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken')
                },
                body: JSON.stringify({ title: title, type: type })
            });

            if (response.ok) {
                const chat = await response.json();
                closeCreateChatModal();

                const fakeUser = { display_name: title[0], avatar_url: null };
                addChatToList(chat, fakeUser);

                const newChatItem = document.querySelector(`.chat-item[data-chat-id="${chat.id}"]`);
                if (newChatItem) {
                    newChatItem.click();
                }
            } else {
                const err = await response.json();
                alert("Ошибка: " + JSON.stringify(err));
            }
        } catch (error) {
            console.error(error);
            alert("Произошла ошибка при создании чата");
        }
    }

    async function startDirectChat(user) {
        try {
            const response = await fetchWithRetry('/api/chats/direct/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken')
                },
                body: JSON.stringify({ user_id: user.id })
            });

            if (response.ok) {
                const chat = await response.json();
                closeSearch();
                addChatToList(chat, user);
                const newChatItem = document.querySelector(`.chat-item[data-chat-id="${chat.id}"]`);
                if (newChatItem) {
                    document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
                    newChatItem.classList.add('active');
                    openChat(chat.id, user.display_name, chat.type, true);
                }
            }
        } catch (error) {
            console.error(error);
        }
    }

    async function joinAndOpenChat(chatId) {
        try {
            const response = await fetchWithRetry(`/api/chats/${chatId}/join/`, {
                method: 'POST',
                headers: { 'X-CSRFToken': getCookie('csrftoken') }
            });

            if (response.ok || response.status === 400) {
                const chatRes = await fetchWithRetry(`/api/chats/${chatId}/`);
                if (chatRes.ok) {
                    const chatData = await chatRes.json();
                    const fakeUser = {
                        display_name: chatData.title ? chatData.title[0] : 'G',
                        avatar_url: null
                    };
                    addChatToList(chatData, fakeUser);
                    const newChatItem = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
                    if (newChatItem) newChatItem.click();
                }
            }
        } catch (error) {
            console.error(error);
        }
    }

    document.getElementById('tab-users').addEventListener('click', () => switchSearchTab('users'));
    document.getElementById('tab-chats').addEventListener('click', () => switchSearchTab('chats'));
    document.getElementById('clear-search').addEventListener('click', (e) => {
        e.preventDefault();
        closeSearch();
    });

    document.getElementById('close-settings-btn').addEventListener('click', closeChatSettings);
    document.getElementById('close-create-chat-modal-btn').addEventListener('click', closeCreateChatModal);

    document.getElementById('chat-settings-btn').addEventListener('click', openChatSettings);
    document.getElementById('leave-chat-btn').addEventListener('click', leaveChat);
    document.getElementById('settings-delete-chat-btn').addEventListener('click', deleteCurrentChat);
    document.getElementById('submit-create-chat-btn').addEventListener('click', submitCreateChat);
    document.getElementById('send-btn').addEventListener('click', () => sendMessage());
});
