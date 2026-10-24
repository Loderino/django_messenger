document.addEventListener("DOMContentLoaded", function() {
    // --- ПЕРЕМЕННЫЕ ---
    let currentChatId = null;
    let currentChatType = null;
    let socket = null;
    let currentUser = window.APP_CONFIG.currentUser;
    let nextPageUrl = null;
    let isLoadingHistory = false;
    let isInitialLoad = false;

    let currentTab = 'users';
    let searchTimeout = null;
    let selectedUser = null;
    let selectedChatForModal = null;

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

    const profileModal = document.getElementById('profile-modal');
    const modalAvatar = document.getElementById('modal-avatar');
    const modalName = document.getElementById('modal-name');
    const modalUsername = document.getElementById('modal-username');
    const modalWriteBtn = document.getElementById('modal-write-btn');

    const chatModal = document.getElementById('chat-modal');
    const chatModalTitle = document.getElementById('chat-modal-title');
    const chatModalType = document.getElementById('chat-modal-type');
    const chatModalJoinBtn = document.getElementById('chat-modal-join-btn');

    const chatSettingsModal = document.getElementById('chat-settings-modal');

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

        // Фикс бага с "съеживанием" поля ввода
        textarea.style.height = 'auto';
        if (draft) {
            textarea.style.height = (textarea.scrollHeight) + 'px';
        } else {
            textarea.style.height = 'auto'; // Сброс
        }
    }

    textarea.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if (this.scrollHeight > 150) this.style.overflowY = 'auto'; else this.style.overflowY = 'hidden';

        if (currentChatId) {
            localStorage.setItem(`draft_${currentChatId}`, this.value);
        }
    });

    textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
            e.preventDefault(); sendMessage();
        }
    });

    // --- НЕОТПРАВЛЕННЫЕ СООБЩЕНИЯ ---
    function saveFailedMessage(chatId, msg) {
        let failed = JSON.parse(localStorage.getItem(`failed_${chatId}`) || '[]');
        // Убираем флаг pending, чтобы при загрузке не крутился спиннер
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
        if (chat.type === 'DIRECT' && user.avatar_url) {
            avatarHtml = `<img src="${user.avatar_url}" class="vk-avatar">`;
        } else {
            const titleToShow = chat.display_title || chat.title || '?';
            avatarHtml = `<div class="vk-avatar bg-secondary">${titleToShow[0].toUpperCase()}</div>`;
        }

        a.innerHTML = `
            ${avatarHtml}
            <div class="flex-grow-1 min-w-0">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="fw-bold text-truncate" style="font-size: 15px;">${chat.display_title || chat.title}</span>
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
            openChat(this.getAttribute('data-chat-id'), this.querySelector('.fw-bold').innerText.trim(), this.getAttribute('data-chat-type'));
        });

        chatList.insertBefore(a, chatList.firstChild);
    }

    document.querySelectorAll('.chat-item').forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
            this.classList.add('active');
            openChat(this.getAttribute('data-chat-id'), this.querySelector('.fw-bold').innerText.trim(), this.getAttribute('data-chat-type'));
        });
    });

    async function openChat(chatId, chatTitle, chatType) {
        currentChatId = chatId;
        currentChatType = chatType;

        loadDraft(chatId);

        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('active-chat-wrapper').style.display = 'flex';
        document.getElementById('active-chat-title').innerText = chatTitle;

        const leaveBtn = document.getElementById('leave-chat-btn');
        const settingsBtn = document.getElementById('chat-settings-btn');

        leaveBtn.style.display = 'none';
        settingsBtn.style.display = 'none';

        let cached = getCachedChat(chatId);

        // 1. МГНОВЕННО РИСУЕМ СООБЩЕНИЯ ИЗ КЭША (если есть)
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

        // 1.5. Выводим неотправленные сообщения (они теперь с флагом is_pending: false)
        const failedMsgs = getFailedMessages(chatId);
        failedMsgs.forEach(msg => {
            renderMessage(msg);
        });
        if (failedMsgs.length > 0) scrollToBottom();

        // 2. ШАПКА ЧАТА
        if (chatType === 'GROUP' || chatType === 'CHANNEL') {
            leaveBtn.style.display = 'block';

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

                    const res = await fetchWithRetry(`/api/chats/${chatId}/members/`);
                    if (currentChatId !== chatId) return;

                    const data = await res.json();
                    const count = data.count !== undefined ? data.count : (data.results ? data.results.length : data.length);

                    document.getElementById('active-chat-members-count').innerText = `${count} участников`;

                    setCachedChat(chatId, { role: chatData.user_role, membersCount: count });
                } catch (e) {
                    if (currentChatId !== chatId) return;
                    console.error(e);
                    document.getElementById('active-chat-members-count').innerText = '';
                }
            }
        } else {
            document.getElementById('active-chat-members-count').innerText = '';
        }

        // 3. СООБЩЕНИЯ
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

                getFailedMessages(chatId).forEach(msg => {
                    renderMessage(msg);
                });

                scrollToBottom();
                isInitialLoad = false;

            } catch (error) {
                if (currentChatId !== chatId) return;
                container.innerHTML = `<div class="text-danger text-center mt-4 w-100">${error.message}</div>`;
            }
        }
    }

    async function leaveChat() {
        if (!currentChatId || !confirm("Вы уверены, что хотите выйти из этого чата?")) return;

        try {
            const response = await fetchWithRetry(`/api/chats/${currentChatId}/leave/`, {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCookie('csrftoken')
                }
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
            : `<a href="${profileUrl}"><img src="${avatarUrl}" class="message-avatar" target="blank_"></a>`;

        const nameTag = (msg.is_pending || msg.is_failed)
            ? `<span class="message-author">${msg.sender_name}</span>`
            : `<a href="${profileUrl}" class="message-author" style="text-decoration: none;" target="blank_">${msg.sender_name}</a>`;

        return `
            <div class="message-row ${rowClass}" id="msg-${msg.id}">
                ${avatarTag}
                <div class="message-content">
                    <div class="message-header">${nameTag}</div>
                    <div class="message-body">
                        <span class="message-text">${msg.text}</span>
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
        if (!text || !currentChatId) return;

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
                const tempEl = document.getElementById(`msg-${tempId}`);
                if (tempEl) tempEl.remove();

                const message = {
                    id: data.id,
                    sender: window.APP_CONFIG.currentUserId, // <-- Важно добавить sender для кэша
                    text: text,
                    sender_name: currentUser,
                    sender_avatar: window.APP_CONFIG.currentUserAvatar,
                    created_at: data.created_at || new Date().toISOString(), // лучше брать с бэка, если есть
                    is_pending: false
                };

                if (!document.getElementById(`msg-${message.id}`)) {
                    renderMessage(message);
                    scrollToBottom();
                }

                if (chatCache[currentChatId]) {
                    const exists = chatCache[currentChatId].messages.some(m => m.id === message.id);
                    if (!exists) {
                        chatCache[currentChatId].messages.push(message);
                    }
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

                if (chatCache[chatId]) {
                    chatCache[chatId].messages.push(data.payload.message);
                }

                if (chatId == currentChatId && data.payload.message.sender_name !== currentUser) {
                    const isScrolledToBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
                    renderMessage(data.payload.message);
                    if (isScrolledToBottom) scrollToBottom();
                }
            }
            else if (data.type === 'chat.direct.created') {
                addChatToList(data.payload.chat, data.payload.user);
            }
            else if (data.type === 'chat.member.joined' || data.type === 'chat.member.left') {
                const chatId = data.payload.chat.id;

                if (chatCache[chatId] && chatCache[chatId].membersCount !== null) {
                    if (data.type === 'chat.member.joined') {
                        chatCache[chatId].membersCount += 1;
                    } else {
                        chatCache[chatId].membersCount -= 1;
                    }
                }

                if (chatId == currentChatId) {
                    const cached = getCachedChat(chatId);
                    if (cached && cached.membersCount !== null) {
                        document.getElementById('active-chat-members-count').innerText = `${cached.membersCount} участников`;
                    } else {
                        fetch(`/api/chats/${currentChatId}/members/`)
                            .then(r => r.json())
                            .then(d => {
                                const count = d.count !== undefined ? d.count : d.results.length;
                                document.getElementById('active-chat-members-count').innerText = `${count} участников`;
                                setCachedChat(chatId, { membersCount: count });
                            });
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
        if (rect.bottom + 100 > window.innerHeight) {
            topPos = rect.top + window.scrollY - 100;
        }

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
        const isClickInsideModal = profileModal.contains(e.target) ||
                                   chatModal.contains(e.target) ||
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
            div.innerHTML = `
                <img src="${user.avatar_url}" class="vk-avatar" style="width: 36px; height: 36px;">
                <div>
                    <div class="fw-bold">${user.display_name}</div>
                    <small class="text-muted">@${user.display_name}</small>
                </div>
            `;
            div.onclick = () => openProfileModal(user);
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
            const titleToShow = chat.display_title || chat.title;

            div.innerHTML = `
                <div class="vk-avatar bg-secondary" style="width: 36px; height: 36px; font-size: 14px;">${titleToShow[0].toUpperCase()}</div>
                <div>
                    <div class="fw-bold">${titleToShow}</div>
                    <small class="text-muted">${chat.type}</small>
                </div>
            `;
            div.onclick = () => openChatModal(chat);
            searchResults.appendChild(div);
        });
    }

    // --- МОДАЛКА ПРОФИЛЯ ПОЛЬЗОВАТЕЛЯ ---
    function openProfileModal(user) {
        selectedUser = user;
        modalAvatar.innerHTML = `
            <img src="${user.avatar_url}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px;">
            <div class="online-dot"></div>
        `;
        modalName.innerText = user.display_name;
        modalUsername.innerText = `@${user.display_name}`;
        modalWriteBtn.onclick = () => {
            closeProfileModal();
            startDirectChat(user);
        };
        profileModal.style.display = 'flex';
    }

    function closeProfileModal() {
        profileModal.style.display = 'none';
    }

    profileModal.addEventListener('click', (e) => {
        if (e.target === profileModal) closeProfileModal();
    });

    // --- МОДАЛКА ЧАТА (ГРУППЫ) ---
    function openChatModal(chat) {
        selectedChatForModal = chat;
        chatModalTitle.innerText = chat.display_title || chat.title;
        let typeRu = chat.type === 'GROUP' ? 'Группа' : (chat.type === 'CHANNEL' ? 'Канал' : chat.type);
        chatModalType.innerText = typeRu;

        if (chat.user_role) {
            chatModalJoinBtn.style.display = 'block';
            chatModalJoinBtn.innerText = "Перейти в чат";
            chatModalJoinBtn.className = "vk-btn w-100";
            chatModalJoinBtn.onclick = () => {
                closeChatModal();
                closeSearch();
                const chatItem = document.querySelector(`.chat-item[data-chat-id="${chat.id}"]`);
                if (chatItem) {
                    chatItem.click();
                } else {
                    window.location.reload();
                }
            };
        } else {
            chatModalJoinBtn.style.display = 'block';
            chatModalJoinBtn.innerText = "Вступить в чат";
            chatModalJoinBtn.onclick = () => {
                closeChatModal();
                joinAndOpenChat(chat.id);
            };
        }

        chatModal.style.display = 'flex';
    }

    function closeChatModal() {
        chatModal.style.display = 'none';
    }

    chatModal.addEventListener('click', (e) => {
        if (e.target === chatModal) closeChatModal();
    });

    // --- НАСТРОЙКИ ЧАТА ---
    function openChatSettings() {
        chatSettingsModal.style.display = 'flex';
        document.getElementById('settings-delete-chat-btn').style.display = 'block';
    }

    function closeChatSettings() {
        chatSettingsModal.style.display = 'none';
    }

    chatSettingsModal.addEventListener('click', (e) => {
        if (e.target === chatSettingsModal) closeChatSettings();
    });

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
                    openChat(chat.id, user.display_name, chat.type);
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
                headers: {
                    'X-CSRFToken': getCookie('csrftoken')
                }
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
                    if (newChatItem) {
                        newChatItem.click();
                    }
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

    document.getElementById('close-profile-btn').addEventListener('click', closeProfileModal);
    document.getElementById('close-chat-modal-btn').addEventListener('click', closeChatModal);
    document.getElementById('close-settings-btn').addEventListener('click', closeChatSettings);
    document.getElementById('close-create-chat-modal-btn').addEventListener('click', closeCreateChatModal);

    document.getElementById('chat-settings-btn').addEventListener('click', openChatSettings);
    document.getElementById('leave-chat-btn').addEventListener('click', leaveChat);
    document.getElementById('settings-delete-chat-btn').addEventListener('click', deleteCurrentChat);
    document.getElementById('submit-create-chat-btn').addEventListener('click', submitCreateChat);
    document.getElementById('send-btn').addEventListener('click', () => sendMessage());
});
