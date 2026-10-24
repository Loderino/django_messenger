// static/js/profile.js
document.addEventListener("DOMContentLoaded", function () {
    const dataEl = document.getElementById('profile-data');
    if (!dataEl) return;

    const userId = dataEl.dataset.userId;
    const isSelf = dataEl.dataset.isSelf === 'true';
    if (!isSelf) return;

    // --- ЭЛЕМЕНТЫ ---
    const topbarName = document.querySelector('.topbar-inner .fw-medium');
    const avatarImg = document.querySelector('#profile-avatar img');
    const avatarWrap = document.getElementById('profile-avatar');
    const sidebarAvatar = document.querySelector('.nav-avatar');

    const bioTextEl = document.getElementById('bio-text');
    const bioWrapper = document.getElementById('bio-wrapper');
    const editBioBtn = document.getElementById('edit-bio-btn');

    const avatarContainer = document.getElementById('avatar-container');
    const avatarInput = document.getElementById('avatar-input');

    // Элементы для редактирования username
    const editNameBtn = document.getElementById('edit-name-btn');
    const usernameText = document.getElementById('username-text');
    const inlineNameInput = document.getElementById('inline-name-input');
    const nameValidationMsg = document.getElementById('name-validation-msg');

    let currentDisplayName = usernameText.innerText.trim();
    let currentBio = bioTextEl.innerText === "Пользователь пока ничего не рассказал о себе." ? "" : bioTextEl.innerText.trim();
    let isNameAvailable = true;

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

    async function patchProfile(data) {
        const formData = new FormData();
        for (const key in data) {
            formData.append(key, data[key]);
        }

        try {
            const res = await fetch(`/api/users/${userId}/`, {
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

    // --- РЕДАКТИРОВАНИЕ ИМЕНИ (ВНУТРИ ПЛАШКИ) ---
    if (editNameBtn) {
        editNameBtn.addEventListener('click', () => {
            // Прячем текст, показываем инпут (префикс @ остается)
            usernameText.style.display = 'none';
            editNameBtn.style.display = 'none';
            inlineNameInput.style.display = 'inline-block';
            inlineNameInput.value = currentDisplayName;
            inlineNameInput.style.width = Math.max(currentDisplayName.length * 8, 60) + 'px';

            inlineNameInput.focus();
            // Ставим курсор в конец
            const valLength = inlineNameInput.value.length;
            inlineNameInput.setSelectionRange(valLength, valLength);

            nameValidationMsg.style.display = 'none';

            let checkTimeout = null;

            inlineNameInput.addEventListener('input', function() {
                const val = this.value.trim();
                this.style.width = Math.max(val.length * 8, 60) + 'px';
                clearTimeout(checkTimeout);

                if (val.length < 4) {
                    nameValidationMsg.style.display = 'block';
                    nameValidationMsg.style.color = '#dc3545';
                    nameValidationMsg.innerText = 'Минимум 4 символа.';
                    isNameAvailable = false;
                    return;
                }
                if (val.includes(' ')) {
                    nameValidationMsg.style.display = 'block';
                    nameValidationMsg.style.color = '#dc3545';
                    nameValidationMsg.innerText = 'Без пробелов.';
                    isNameAvailable = false;
                    return;
                }
                if (val === currentDisplayName) {
                    nameValidationMsg.style.display = 'none';
                    isNameAvailable = true;
                    return;
                }

                nameValidationMsg.style.display = 'block';
                nameValidationMsg.style.color = 'var(--text-muted)';
                nameValidationMsg.innerText = 'Проверка...';

                checkTimeout = setTimeout(async () => {
                    try {
                        const res = await fetch(`/api/users/?display_name=${encodeURIComponent(val)}`);
                        if (res.ok) {
                            const users = await res.json();

                            if (users.length > 0) {
                                nameValidationMsg.style.color = '#dc3545';
                                nameValidationMsg.innerText = 'Имя занято.';
                                isNameAvailable = false;
                            } else {
                                nameValidationMsg.style.color = '#4caf50';
                                nameValidationMsg.innerText = 'Имя свободно!';
                                isNameAvailable = true;
                            }
                        }
                    } catch {
                        nameValidationMsg.style.display = 'none';
                        isNameAvailable = true;
                    }
                }, 400);
            });

            const saveName = async () => {
                const newVal = inlineNameInput.value.trim();

                if (!isNameAvailable || newVal === currentDisplayName) {
                    usernameText.style.display = 'inline';
                    editNameBtn.style.display = 'inline-block';
                    inlineNameInput.style.display = 'none';
                    nameValidationMsg.style.display = 'none';
                    return;
                }

                const result = await patchProfile({ display_name: newVal });
                if (result) {
                    currentDisplayName = result.display_name;
                    usernameText.innerText = currentDisplayName;
                    if (topbarName) topbarName.innerText = currentDisplayName;
                    window.history.replaceState(null, '', '/user/' + currentDisplayName + '/');
                }

                usernameText.style.display = 'inline';
                editNameBtn.style.display = 'inline-block';
                inlineNameInput.style.display = 'none';
                nameValidationMsg.style.display = 'none';
            };

            inlineNameInput.addEventListener('blur', saveName);
            inlineNameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); inlineNameInput.blur(); }
                if (e.key === 'Escape') {
                    inlineNameInput.value = currentDisplayName;
                    inlineNameInput.removeEventListener('blur', saveName);
                    usernameText.style.display = 'inline';
                    editNameBtn.style.display = 'inline-block';
                    inlineNameInput.style.display = 'none';
                    nameValidationMsg.style.display = 'none';
                }
            });
        });
    }

    // --- РЕДАКТИРОВАНИЕ БИО (INLINE) ---
    if (editBioBtn) {
        editBioBtn.addEventListener('click', () => {
            if (document.getElementById('inline-bio-input')) return;

            bioTextEl.style.display = 'none';
            editBioBtn.style.display = 'none';

            const textarea = document.createElement('textarea');
            textarea.id = 'inline-bio-input';
            textarea.className = 'inline-input textarea';
            textarea.value = currentBio;
            textarea.maxLength = 500;
            bioWrapper.appendChild(textarea);
            textarea.focus();

            const saveBio = async () => {
                const newVal = textarea.value.trim();

                if (newVal === currentBio) {
                    bioTextEl.innerText = currentBio || "Пользователь пока ничего не рассказал о себе.";
                    bioTextEl.style.display = 'block';
                    editBioBtn.style.display = 'inline-block';
                    textarea.remove();
                    return;
                }

                const result = await patchProfile({ bio: newVal });
                if (result) {
                    currentBio = result.bio || "";
                    bioTextEl.innerText = currentBio || "Пользователь пока ничего не рассказал о себе.";
                }

                bioTextEl.style.display = 'block';
                editBioBtn.style.display = 'inline-block';
                textarea.remove();
            };

            textarea.addEventListener('blur', saveBio);
            textarea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); textarea.blur(); }
                if (e.key === 'Escape') {
                    textarea.removeEventListener('blur', saveBio);
                    bioTextEl.innerText = currentBio || "Пользователь пока ничего не рассказал о себе.";
                    bioTextEl.style.display = 'block';
                    editBioBtn.style.display = 'inline-block';
                    textarea.remove();
                }
            });
        });
    }

    // --- ЗАГРУЗКА АВАТАРКИ ---
    if (avatarContainer && avatarInput) {
        avatarContainer.addEventListener('click', () => avatarInput.click());

        avatarInput.addEventListener('change', async () => {
            if (!avatarInput.files.length) return;

            const file = avatarInput.files[0];
            const result = await patchProfile({ avatar: file });

            if (result && result.avatar_url) {
                const newSrc = result.avatar_url + "?t=" + Date.now();

                if (avatarImg) {
                    avatarImg.src = newSrc;
                } else {
                    avatarWrap.innerHTML = `<img src="${newSrc}" alt="${currentDisplayName}">`;
                }

                if (sidebarAvatar) sidebarAvatar.src = newSrc;
            }

            avatarInput.value = '';
        });
    }
});
