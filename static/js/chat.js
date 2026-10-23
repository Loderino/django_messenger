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

    // --- ЛОГИКА TEXTAREA ---
    textarea.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if (this.scrollHeight > 150) this.style.overflowY = 'auto'; else this.style.overflowY = 'hidden';
    });

    textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
            e.preventDefault(); sendMessage();
        }
    });

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
        nextPageUrl = null;

        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('active-chat-wrapper').style.display = 'flex';
        document.getElementById('active-chat-title').innerText = chatTitle;

        const leaveBtn = document.getElementById('leave-chat-btn');
        const settingsBtn = document.getElementById('chat-settings-btn');

        leaveBtn.style.display = 'none';
        settingsBtn.style.display = 'none';

        if (chatType === 'GROUP' || chatType === 'CHANNEL') {
            leaveBtn.style.display = 'block';

            try {
                const chatRes = await fetch(`/api/chats/${chatId}/`);
                const chatData = await chatRes.json();
                if (chatData.user_role === 'OWNER' || chatData.user_role === 'ADMIN') {
                    settingsBtn.style.display = 'block';
                }
            } catch (e) { console.error(e); }

            try {
                const res = await fetch(`/api/chats/${chatId}/members/`);
                const data = await res.json();
                const count = data.count !== undefined ? data.count : (data.results ? data.results.length : data.length);
                document.getElementById('active-chat-members-count').innerText = `${count} участников`;
            } catch (e) {
                document.getElementById('active-chat-members-count').innerText = '';
            }
        } else {
            document.getElementById('active-chat-members-count').innerText = '';
        }

        container.innerHTML = '<div class="text-center text-muted mt-4 w-100">Загрузка сообщений...</div>';
        isInitialLoad = true;

        try {
            const response = await fetch(`/api/chats/${chatId}/messages/`);
            if (!response.ok) throw new Error("Ошибка загрузки");

            const data = await response.json();
            nextPageUrl = data.next;

            const messages = data.results ? [...data.results].reverse() : [...data].reverse();

            container.innerHTML = '';
            messages.forEach(msg => renderMessage(msg));

            scrollToBottom();
            isInitialLoad = false;

        } catch (error) {
            container.innerHTML = `<div class="text-danger text-center mt-4 w-100">${error.message}</div>`;
        }
    }

    async function leaveChat() {
        if (!currentChatId || !confirm("Вы уверены, что хотите выйти из этого чата?")) return;

        try {
            const response = await fetch(`/api/chats/${currentChatId}/leave/`, {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCookie('csrftoken')
                }
            });

            if (response.ok || response.status === 204) {
                const chatItem = document.querySelector(`.chat-item[data-chat-id="${currentChatId}"]`);
                if (chatItem) chatItem.remove();

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

            try {
                const response = await fetch(nextPageUrl);
                const data = await response.json();
                nextPageUrl = data.next;

                const messages = [...data.results].reverse();
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
            } finally {
                isLoadingHistory = false;
            }
        }
    });

    function createMessageHTML(msg) {
        const time = new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        return `
            <div class="message-row">
                <img src="${msg.sender_avatar}" class="message-avatar">
                <div class="message-content">
                    <div class="message-header"><span class="message-author">${msg.sender_name}</span></div>
                    <div class="message-body">
                        <span class="message-text">${msg.text}</span>
                        <span class="message-time">${time}</span>
                    </div>
                </div>
            </div>
        `;
    }

    function renderMessage(msg) {
        container.insertAdjacentHTML('beforeend', createMessageHTML(msg));
    }

    async function sendMessage() {
        const text = textarea.value.trim();
        if (!text || !currentChatId) return;

        textarea.value = '';
        textarea.style.height = 'auto';

        try {
            await fetch('/api/messages/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken')
                },
                body: JSON.stringify({ chat: currentChatId, text: text })
            });
        } catch (error) {
            console.error(error);
        }
    }

    document.getElementById('send-btn').addEventListener('click', sendMessage);

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
                if (data.payload.chat.id == currentChatId) {
                    const isScrolledToBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
                    renderMessage(data.payload.message);
                    if (isScrolledToBottom) scrollToBottom();
                }
            }
            else if (data.type === 'chat.direct.created') {
                addChatToList(data.payload.chat, data.payload.user);
            }
            else if (data.type === 'chat.member.joined') {
                if (data.payload.chat.id == currentChatId) {
                    fetch(`/api/chats/${currentChatId}/members/`)
                        .then(r => r.json())
                        .then(d => {
                            const count = d.count !== undefined ? d.count : d.results.length;
                            document.getElementById('active-chat-members-count').innerText = `${count} участников`;
                        });
                }
            }
            else if (data.type === 'chat.member.left') {
                if (data.payload.chat.id == currentChatId) {
                    fetch(`/api/chats/${currentChatId}/members/`)
                        .then(r => r.json())
                        .then(d => {
                            const count = d.count !== undefined ? d.count : d.results.length;
                            document.getElementById('active-chat-members-count').innerText = `${count} участников`;
                        });
                }
            }
            else if (data.type === 'chat.state.deleted') {
                const deletedChatId = data.payload.chat_id;

                const chatItem = document.querySelector(`.chat-item[data-chat-id="${deletedChatId}"]`);
                if (chatItem) chatItem.remove();

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
                const res = await fetch(`/api/users/search/?q=${encodeURIComponent(query)}`);
                const users = await res.json();
                renderUsers(users);
            } else {
                const res = await fetch(`/api/chats/search/?q=${encodeURIComponent(query)}`);
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
                    <div class="fw-bold">${user.public_name}</div>
                    <small class="text-muted">@${user.username}</small>
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
        modalName.innerText = user.public_name;
        modalUsername.innerText = `@${user.username}`;
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
            const response = await fetch(`/api/chats/${currentChatId}/`, {
                method: 'DELETE',
                headers: { 'X-CSRFToken': getCookie('csrftoken') }
            });

            if (response.ok || response.status === 204) {
                closeChatSettings();

                const chatItem = document.querySelector(`.chat-item[data-chat-id="${currentChatId}"]`);
                if (chatItem) chatItem.remove();

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
            const response = await fetch('/api/chats/', {
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

                const fakeUser = { public_name: title[0], avatar_url: null };
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
            const response = await fetch('/api/chats/direct/', {
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
                    openChat(chat.id, user.public_name, chat.type);
                }
            }
        } catch (error) {
            console.error(error);
        }
    }

    async function joinAndOpenChat(chatId) {
        try {
            const response = await fetch(`/api/chats/${chatId}/join/`, {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCookie('csrftoken')
                }
            });

            if (response.ok || response.status === 400) {
                const chatRes = await fetch(`/api/chats/${chatId}/`);
                if (chatRes.ok) {
                    const chatData = await chatRes.json();

                    const fakeUser = {
                        public_name: chatData.title ? chatData.title[0] : 'G',
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
    document.getElementById('open-create-chat-btn').addEventListener('click', () => {
        newChatTitleInput.value = '';
        newChatTypeSelect.value = 'GROUP';
        createChatModal.style.display = 'flex';
        newChatTitleInput.focus();
    });

    document.getElementById('close-profile-btn').addEventListener('click', closeProfileModal);
    document.getElementById('close-chat-modal-btn').addEventListener('click', closeChatModal);
    document.getElementById('close-settings-btn').addEventListener('click', closeChatSettings);
    document.getElementById('close-create-chat-modal-btn').addEventListener('click', closeCreateChatModal);

    document.getElementById('chat-settings-btn').addEventListener('click', openChatSettings);
    document.getElementById('leave-chat-btn').addEventListener('click', leaveChat);
    document.getElementById('settings-delete-chat-btn').addEventListener('click', deleteCurrentChat);
    document.getElementById('submit-create-chat-btn').addEventListener('click', submitCreateChat);
    document.getElementById('send-btn').addEventListener('click', sendMessage);
});
