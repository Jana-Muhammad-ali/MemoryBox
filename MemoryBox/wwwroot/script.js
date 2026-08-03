// ---- nav / screen switching ----
const screens = document.querySelectorAll('.screen');
const navLinks = document.querySelectorAll('.nav-link');

function showScreen(id) {
    screens.forEach(s => s.classList.toggle('active', s.id === id));
    navLinks.forEach(l => l.classList.toggle('active', l.dataset.screen === id));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (id === 'home' && getToken()) { refreshCapsules(); }
    if (id === 'add-moment' && getToken()) { loadMomentsScreen(); }
}

// where to send the user right after they log in, if they were stopped on the way to "create"
let pendingGoto = null;

// "Create a capsule" is gated: only logged-in users can reach it.
// Anyone else gets sent to Log in first, then bounced straight into the wizard.
function goToCreateOrLogin() {
    if (getToken()) {
        resetWizard();
        showScreen('create');
    } else {
        pendingGoto = 'create';
        showScreen('login');
    }
}

// The marketing homepage is gated too: only logged-in (registered) users can see it.
// Anyone else gets sent to Register instead.
function goToHomeOrRegister() {
    if (getToken()) { showScreen('home'); }
    else { showScreen('register'); }
}

// "Add a Moment" is gated the same way as "Create a capsule".
function goToAddMomentOrLogin() {
    if (getToken()) {
        showScreen('add-moment');
    } else {
        pendingGoto = 'add-moment';
        showScreen('login');
    }
}

navLinks.forEach(link => {
    link.addEventListener('click', () => {
        if (link.dataset.screen === 'create') { goToCreateOrLogin(); }
        else if (link.dataset.screen === 'home') { goToHomeOrRegister(); }
        else if (link.dataset.screen === 'add-moment') { goToAddMomentOrLogin(); }
        else { showScreen(link.dataset.screen); }
    });
});

document.querySelectorAll('[data-goto]').forEach(el => {
    el.addEventListener('click', (e) => {
        e.preventDefault();
        const target = el.dataset.goto;
        if (target === 'create-reset' || target === 'create') { goToCreateOrLogin(); }
        else { showScreen(target); }
    });
});

// brand logo returns home
const brandBtn = document.querySelector('.brand');
if (brandBtn) { brandBtn.addEventListener('click', () => goToHomeOrRegister()); }

// ---- create capsule wizard ----
let selectedType = null;
let selectedWho = 'me';
const stepPanels = document.querySelectorAll('[data-step-panel]');
const stepIndicators = document.querySelectorAll('[data-step-indicator]');

function goToStep(n) {
    stepPanels.forEach(p => p.classList.toggle('active', p.dataset.stepPanel == n));
    stepIndicators.forEach(s => {
        const val = parseInt(s.dataset.stepIndicator);
        s.classList.toggle('done', val < n);
        s.classList.toggle('current', val == n);
    });
}

// step 1: type selection
document.querySelectorAll('.type-card').forEach(card => {
    card.addEventListener('click', () => {
        document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedType = card.dataset.type;
        const toStep2 = document.getElementById('to-step-2');
        if (toStep2) toStep2.disabled = false;

        const subs = {
            message: "Write the message you want to seal away.",
            photo: "Upload the photos you want to save for later.",
            voice: "Record the voice note you want to seal away.",
            video: "Upload the video you want to save for later.",
            moments: "Upload photos or videos now — come back and add more any time before it unlocks."
        };
        const fillSub = document.getElementById('fill-sub');
        if (fillSub) fillSub.textContent = subs[selectedType];
        ['message', 'photo', 'voice', 'video', 'moments'].forEach(t => {
            const el = document.getElementById('fill-' + t);
            if (el) el.style.display = (t === selectedType) ? 'block' : 'none';
        });
    });
});

const toStep2Btn = document.getElementById('to-step-2');
if (toStep2Btn) { toStep2Btn.addEventListener('click', () => goToStep(2)); }

document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => goToStep(btn.dataset.back));
});
document.querySelectorAll('[data-forward]').forEach(btn => {
    btn.addEventListener('click', () => goToStep(btn.dataset.forward));
});

// step 2: who is this for
document.querySelectorAll('.who-option').forEach(opt => {
    opt.addEventListener('click', () => {
        document.querySelectorAll('.who-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        selectedWho = opt.dataset.who;
        const rf = document.getElementById('recipient-fields');
        if (rf) rf.classList.toggle('show', selectedWho === 'other');
    });
});

// step 3: date preview
function updatePreview() {
    const dateInput = document.getElementById('unlock-date');
    const timeInput = document.getElementById('unlock-time');
    const el = document.getElementById('preview-date');
    if (!dateInput || !el) return;
    const date = dateInput.value;
    const time = timeInput ? timeInput.value : '';
    if (date) {
        const d = new Date(date + 'T' + (time || '00:00'));
        const opts = { month: 'short', day: 'numeric', year: 'numeric' };
        el.textContent = d.toLocaleDateString('en-US', opts) + (time ? ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');
    } else {
        el.textContent = 'Pick a date';
    }
}
const unlockDate = document.getElementById('unlock-date');
const unlockTime = document.getElementById('unlock-time');
if (unlockDate) unlockDate.addEventListener('change', updatePreview);
if (unlockTime) unlockTime.addEventListener('change', updatePreview);

// step 3 -> 4: actually seal the capsule (saves it to the database via the API)
const sealBtn = document.getElementById('seal-btn');
if (sealBtn) {
    sealBtn.addEventListener('click', async () => {
        clearFormError('seal-error');

        if (!getToken()) { pendingGoto = 'create'; showScreen('login'); return; }
        if (!selectedType) { showFormError('seal-error', 'Pick what you want to save first.'); goToStep(1); return; }

        const dateVal = unlockDate ? unlockDate.value : '';
        const timeVal = unlockTime ? unlockTime.value : '';
        if (!dateVal) { showFormError('seal-error', 'Pick an unlock date.'); return; }
        const unlockLocal = new Date(dateVal + 'T' + (timeVal || '00:00'));
        if (isNaN(unlockLocal.getTime()) || unlockLocal <= new Date()) {
            showFormError('seal-error', 'The unlock date/time has to be in the future.');
            return;
        }

        // "message" capsules can optionally carry an attached photo, and "photo" capsules
        // can optionally carry a short message — pull whichever text box is relevant.
        const messageText = selectedType === 'photo'
            ? (document.getElementById('photo-message-text')?.value || '').trim()
            : (document.querySelector('#fill-message textarea')?.value || '').trim();
        if (selectedType === 'message' && !messageText) {
            showFormError('seal-error', 'Write your message first.');
            goToStep(2);
            return;
        }
        if (selectedType === 'photo' && selectedPhotoFiles.length === 0) {
            showFormError('seal-error', 'Upload at least one photo.');
            goToStep(2);
            return;
        }
        if (selectedType === 'moments' && selectedMomentsFiles.length === 0) {
            showFormError('seal-error', 'Upload at least one photo or video to get started.');
            goToStep(2);
            return;
        }
        if (selectedType === 'video' && !selectedVideoFile) {
            showFormError('seal-error', 'Upload a video.');
            goToStep(2);
            return;
        }
        if (selectedType === 'voice' && !recordedVoiceBlob) {
            showFormError('seal-error', 'Record a voice note first.');
            goToStep(2);
            return;
        }

        const recName = (document.getElementById('rec-name')?.value || '').trim();
        const recEmail = (document.getElementById('rec-email')?.value || '').trim();
        if (selectedWho === 'other' && !recEmail) {
            showFormError('seal-error', "Enter the recipient's email.");
            goToStep(2);
            return;
        }

        const formData = new FormData();
        formData.append('type', selectedType);
        formData.append('messageText', messageText);
        formData.append('recipientType', selectedWho);
        formData.append('recipientName', recName);
        formData.append('recipientEmail', recEmail);
        formData.append('unlockAtUtc', unlockLocal.toISOString());

        if (selectedType === 'photo') { selectedPhotoFiles.forEach(f => formData.append('files', f)); }
        else if (selectedType === 'moments') { selectedMomentsFiles.forEach(f => formData.append('files', f)); }
        else if (selectedType === 'video' && selectedVideoFile) { formData.append('files', selectedVideoFile); }
        else if (selectedType === 'voice' && recordedVoiceBlob) { formData.append('files', recordedVoiceBlob, 'voice-note.webm'); }
        else if (selectedType === 'message' && selectedMessagePhotoFiles.length > 0) { selectedMessagePhotoFiles.forEach(f => formData.append('files', f)); }

        sealBtn.disabled = true;
        try {
            const res = await fetch(API_BASE + '/api/capsules', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + getToken() }, // no Content-Type: the browser sets the multipart boundary itself
                body: formData
            });
            if (res.status === 401) {
                clearAuth();
                refreshAuthUI();
                pendingGoto = 'create';
                showScreen('login');
                showFormError('login-error', 'Your session expired. Please log in again to finish sealing your capsule.');
                return;
            }
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                showFormError('seal-error', err?.error || 'Could not seal the capsule. Please try again.');
                return;
            }

            const previewText = document.getElementById('preview-date').textContent;
            document.getElementById('confirm-date').textContent = previewText === 'Pick a date' ? 'the date you choose' : previewText;
            goToStep(4);
        } catch (e) {
            showFormError('seal-error', 'Network error. Please try again.');
        } finally {
            sealBtn.disabled = false;
        }
    });
}

// waveform decoration
const wf = document.getElementById('waveform');
const waveBars = [];
if (wf) {
    for (let i = 0; i < 28; i++) {
        const bar = document.createElement('div');
        bar.className = 'wave-bar';
        bar.style.height = (8 + Math.random() * 24) + 'px';
        wf.appendChild(bar);
        waveBars.push(bar);
    }
}

// ---- step 2: real media selection (photo / video upload, voice recording) ----
let selectedPhotoFiles = [];
let selectedVideoFile = null;
let selectedMomentsFiles = [];
let selectedMemoryBoxFiles = [];
let recordedVoiceBlob = null;
let selectedMessagePhotoFiles = []; // optional photo(s) attached to a "message" capsule

const photoInput = document.getElementById('photo-input');
const photoDropzone = document.getElementById('photo-dropzone');
if (photoDropzone && photoInput) {
    photoDropzone.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', () => {
        const incoming = Array.from(photoInput.files || []);
        selectedPhotoFiles = [...selectedPhotoFiles, ...incoming].slice(0, 10);
        photoInput.value = '';
        renderFileChips('photo');
    });
}

// optional photo attached to a "message" capsule
const messageAddPhotoBtn = document.getElementById('message-add-photo-btn');
const messagePhotoAttach = document.getElementById('message-photo-attach');
const messagePhotoInput = document.getElementById('message-photo-input');
const messagePhotoDropzone = document.getElementById('message-photo-dropzone');
if (messageAddPhotoBtn && messagePhotoAttach) {
    messageAddPhotoBtn.addEventListener('click', () => {
        messagePhotoAttach.style.display = 'block';
        messageAddPhotoBtn.classList.add('is-open');
    });
}
if (messagePhotoDropzone && messagePhotoInput) {
    messagePhotoDropzone.addEventListener('click', () => messagePhotoInput.click());
    messagePhotoInput.addEventListener('change', () => {
        const incoming = Array.from(messagePhotoInput.files || []);
        selectedMessagePhotoFiles = [...selectedMessagePhotoFiles, ...incoming].slice(0, 5);
        messagePhotoInput.value = '';
        renderFileChips('message-photo');
    });
}

// optional message attached to a "photo" capsule
const photoAddMessageBtn = document.getElementById('photo-add-message-btn');
const photoMessageAttach = document.getElementById('photo-message-attach');
if (photoAddMessageBtn && photoMessageAttach) {
    photoAddMessageBtn.addEventListener('click', () => {
        photoMessageAttach.style.display = 'block';
        photoAddMessageBtn.classList.add('is-open');
        const ta = document.getElementById('photo-message-text');
        if (ta) ta.focus();
    });
}

const videoInput = document.getElementById('video-input');
const videoDropzone = document.getElementById('video-dropzone');
if (videoDropzone && videoInput) {
    videoDropzone.addEventListener('click', () => videoInput.click());
    videoInput.addEventListener('change', () => {
        selectedVideoFile = videoInput.files && videoInput.files[0] ? videoInput.files[0] : null;
        videoInput.value = '';
        renderFileChips('video');
    });
}

const momentsInput = document.getElementById('moments-input');
const momentsDropzone = document.getElementById('moments-dropzone');
if (momentsDropzone && momentsInput) {
    momentsDropzone.addEventListener('click', () => momentsInput.click());
    momentsInput.addEventListener('change', () => {
        const incoming = Array.from(momentsInput.files || []);
        selectedMomentsFiles = [...selectedMomentsFiles, ...incoming].slice(0, 20);
        momentsInput.value = '';
        renderFileChips('moments');
    });
}

function renderFileChips(kind) {
    const container = document.getElementById(kind + '-chips');
    if (!container) return;
    container.innerHTML = '';
    const files = kind === 'photo' ? selectedPhotoFiles
        : kind === 'moments' ? selectedMomentsFiles
            : kind === 'mb' ? selectedMemoryBoxFiles
                : kind === 'message-photo' ? selectedMessagePhotoFiles
                    : (selectedVideoFile ? [selectedVideoFile] : []);
    files.forEach((file, idx) => {
        const chip = document.createElement('div');
        chip.className = 'file-chip';
        chip.innerHTML = `<span>${file.name}</span>`;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', () => {
            if (kind === 'photo') { selectedPhotoFiles.splice(idx, 1); }
            else if (kind === 'moments') { selectedMomentsFiles.splice(idx, 1); }
            else if (kind === 'mb') { selectedMemoryBoxFiles.splice(idx, 1); }
            else if (kind === 'message-photo') { selectedMessagePhotoFiles.splice(idx, 1); }
            else { selectedVideoFile = null; }
            renderFileChips(kind);
        });
        chip.appendChild(removeBtn);
        container.appendChild(chip);
    });
}

// ---- voice recording via MediaRecorder ----
let mediaRecorder = null;
let recordChunks = [];
let recordStream = null;
let recordStartMs = 0;
let recordTimerHandle = null;

const recordBtn = document.getElementById('record-btn');
const recordTimeEl = document.getElementById('record-time');
const recordStatusEl = document.getElementById('record-status');

function formatSeconds(totalSec) {
    const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const s = Math.floor(totalSec % 60).toString().padStart(2, '0');
    return m + ':' + s;
}

function resetRecordingUI() {
    if (recordTimeEl) recordTimeEl.textContent = '00:00';
    if (recordStatusEl) recordStatusEl.textContent = 'Tap the button to start recording.';
    if (recordBtn) { recordBtn.classList.remove('recording'); recordBtn.textContent = '●'; }
    waveBars.forEach(b => b.classList.remove('live'));
}

if (recordBtn) {
    recordBtn.addEventListener('click', async () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            if (recordStatusEl) recordStatusEl.textContent = "This browser can't record audio.";
            return;
        }
        try {
            recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            if (recordStatusEl) recordStatusEl.textContent = 'Microphone access was denied.';
            return;
        }
        recordChunks = [];
        mediaRecorder = new MediaRecorder(recordStream);
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            recordedVoiceBlob = new Blob(recordChunks, { type: 'audio/webm' });
            recordStream.getTracks().forEach(t => t.stop());
            clearInterval(recordTimerHandle);
            recordBtn.classList.remove('recording');
            recordBtn.textContent = '●';
            waveBars.forEach(b => b.classList.remove('live'));
            if (recordStatusEl) recordStatusEl.textContent = 'Recording saved. Tap again to re-record.';
        };
        mediaRecorder.start();
        recordStartMs = Date.now();
        recordBtn.classList.add('recording');
        recordBtn.textContent = '■';
        waveBars.forEach(b => b.classList.add('live'));
        if (recordStatusEl) recordStatusEl.textContent = 'Recording…';
        recordTimerHandle = setInterval(() => {
            const elapsed = Math.floor((Date.now() - recordStartMs) / 1000);
            if (recordTimeEl) recordTimeEl.textContent = formatSeconds(elapsed);
        }, 250);
    });
}

function resetWizard() {
    selectedType = null; selectedWho = 'me';
    document.querySelectorAll('.type-card').forEach(c => c.classList.remove('selected'));
    if (toStep2Btn) toStep2Btn.disabled = true;
    document.querySelectorAll('.who-option').forEach(o => o.classList.remove('selected'));
    const meOption = document.querySelector('[data-who="me"]');
    if (meOption) meOption.classList.add('selected');
    const rf = document.getElementById('recipient-fields');
    if (rf) rf.classList.remove('show');
    if (unlockDate) unlockDate.value = '';
    if (unlockTime) unlockTime.value = '';
    updatePreview();

    const msgBox = document.querySelector('#fill-message textarea');
    if (msgBox) msgBox.value = '';
    const photoMsgBox = document.getElementById('photo-message-text');
    if (photoMsgBox) photoMsgBox.value = '';
    const recName = document.getElementById('rec-name');
    const recEmail = document.getElementById('rec-email');
    if (recName) recName.value = '';
    if (recEmail) recEmail.value = '';

    selectedPhotoFiles = [];
    selectedVideoFile = null;
    selectedMomentsFiles = [];
    selectedMessagePhotoFiles = [];
    recordedVoiceBlob = null;
    renderFileChips('photo');
    renderFileChips('video');
    renderFileChips('moments');
    renderFileChips('message-photo');
    resetRecordingUI();
    clearFormError('seal-error');

    if (messagePhotoAttach) messagePhotoAttach.style.display = 'none';
    if (messageAddPhotoBtn) messageAddPhotoBtn.classList.remove('is-open');
    if (photoMessageAttach) photoMessageAttach.style.display = 'none';
    if (photoAddMessageBtn) photoAddMessageBtn.classList.remove('is-open');

    goToStep(1);
}

// ---- custom password show/hide toggle ----
document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (!input) return;
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.classList.toggle('is-visible', !showing);
        btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
});

// ==========================================================
// ---- AUTH: connects the Login / Register screens to the
//      ASP.NET Core Identity API (MapIdentityApi) ----
// ==========================================================
const API_BASE = ''; // same origin (site + api served from the same port) — leave empty

function saveAuth(token) {
    localStorage.setItem('mb_token', token);
}
function getToken() {
    return localStorage.getItem('mb_token');
}
function saveUserName(name) {
    if (name) localStorage.setItem('mb_name', name);
    else localStorage.removeItem('mb_name');
}
function getUserName() {
    return localStorage.getItem('mb_name');
}
function clearAuth() {
    localStorage.removeItem('mb_token');
    localStorage.removeItem('mb_name');
}

async function apiFetch(path, options = {}) {
    const token = getToken();
    const headers = Object.assign(
        { 'Content-Type': 'application/json' },
        options.headers || {},
        token ? { Authorization: 'Bearer ' + token } : {}
    );
    const res = await fetch(API_BASE + path, { ...options, headers });
    if (res.status === 401 && token) {
        clearAuth();
        refreshAuthUI();
        showScreen('login');
        showFormError('login-error', 'Your session expired. Please log in again.');
    }
    return res;
}

function showFormError(elId, message) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
}
function clearFormError(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = '';
    el.classList.remove('show');
}

function refreshAuthUI() {
    const loggedIn = !!getToken();
    const navLogin = document.getElementById('nav-login');
    const navRegister = document.getElementById('nav-register');
    const navLogout = document.getElementById('nav-logout');
    if (navLogin) navLogin.style.display = loggedIn ? 'none' : '';
    if (navRegister) navRegister.style.display = loggedIn ? 'none' : '';
    if (navLogout) navLogout.style.display = loggedIn ? '' : 'none';
    updateHeroForUser();
}

function updateHeroForUser() {
    const heading = document.getElementById('hero-heading');
    const sub = document.getElementById('hero-sub');
    const letter = document.getElementById('hero-letter');
    const seal = document.getElementById('hero-seal');
    const firstName = (getUserName() || '').trim().split(' ')[0];

    const escapeHtml = (str) => str.replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    if (firstName) {
        const safeName = escapeHtml(firstName);
        if (heading) heading.innerHTML = `Some things are worth the wait, <span class="hero-name">${safeName}</span>.`;
        if (sub) sub.textContent = `Write a message to future ${firstName}, record your voice, or save a few photos — then seal it until the exact moment it's meant for. Yours to open later, or a gift for someone else's inbox.`;
        if (letter) letter.textContent = `Dear future ${firstName} — open this when the time is right.`;
        if (seal) seal.textContent = firstName.charAt(0).toUpperCase();
    } else {
        if (heading) heading.textContent = 'Some things are worth the wait.';
        if (sub) sub.textContent = "Write a message, record your voice, or save a few photos — then seal it until the exact moment it's meant for. Yours to open later, or a gift for someone else's inbox.";
        if (letter) letter.textContent = 'Dear future you — open this when the time is right.';
        if (seal) seal.textContent = 'M';
    }
}


const registerBtn = document.getElementById('register-submit');
if (registerBtn) {
    registerBtn.addEventListener('click', async () => {
        clearFormError('register-error');
        const name = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const pass = document.getElementById('reg-pass').value;
        const pass2 = document.getElementById('reg-pass2').value;
        const terms = document.getElementById('reg-terms').checked;
        const trusteeName = document.getElementById('reg-trustee-name').value.trim();
        const trusteeEmail = document.getElementById('reg-trustee-email').value.trim();

        if (!name || !email || !pass) { showFormError('register-error', 'Please fill in all fields.'); return; }
        if (pass !== pass2) { showFormError('register-error', "Passwords don't match."); return; }
        if (!terms) { showFormError('register-error', 'Please accept the Terms of Service.'); return; }
        if (trusteeEmail && trusteeEmail.toLowerCase() === email.toLowerCase()) {
            showFormError('register-error', 'Your trusted contact should be someone other than yourself.');
            return;
        }

        registerBtn.disabled = true;
        try {
            const res = await apiFetch('/api/auth/register', {
                method: 'POST',
                body: JSON.stringify({
                    email,
                    password: pass,
                    fullName: name,
                    trustedContactName: trusteeName || null,
                    trustedContactEmail: trusteeEmail || null
                })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                const msg = err?.errors ? Object.values(err.errors).flat().join(' ') : 'Registration failed. Try a different email or a stronger password.';
                showFormError('register-error', msg);
                return;
            }
            
            await doLogin(email, pass, 'register-error');
        } catch (e) {
            showFormError('register-error', 'Network error. Please try again.');
        } finally {
            registerBtn.disabled = false;
        }
    });
}


const loginBtn = document.getElementById('login-submit');
if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
        clearFormError('login-error');
        const email = document.getElementById('login-email').value.trim();
        const pass = document.getElementById('login-pass').value;
        if (!email || !pass) { showFormError('login-error', 'Please enter your email and password.'); return; }
        loginBtn.disabled = true;
        await doLogin(email, pass, 'login-error');
        loginBtn.disabled = false;
    });
}

async function doLogin(email, password, errorElId) {
    try {
        const res = await fetch(API_BASE + '/api/auth/login?useCookies=false', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        if (!res.ok) {
            showFormError(errorElId, 'Incorrect email or password.');
            return;
        }
        const data = await res.json(); 
        saveAuth(data.accessToken);
        saveUserName(data.fullName);
        refreshAuthUI();

        if (pendingGoto === 'create') {
            pendingGoto = null;
            resetWizard();
            showScreen('create');
        } else if (pendingGoto === 'add-moment') {
            pendingGoto = null;
            showScreen('add-moment');
        } else {
            showScreen('home'); 
        }
    } catch (e) {
        showFormError(errorElId, 'Network error. Please try again.');
    }
}

// ---- Logout ----
const logoutBtn = document.getElementById('nav-logout');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        clearAuth();
        refreshAuthUI();
        showScreen('home');
    });
}

async function addMomentsToCapsule(capsuleId, files) {
    if (!getToken()) { pendingGoto = 'create'; showScreen('login'); return { ok: false }; }
    if (!files || files.length === 0) return { ok: false, error: 'Pick at least one photo or video first.' };

    const formData = new FormData();
    Array.from(files).forEach(f => formData.append('files', f));

    try {
        const res = await fetch(API_BASE + `/api/capsules/${capsuleId}/moments`, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + getToken() }, 
            body: formData
        });
        if (res.status === 401) {
            clearAuth();
            refreshAuthUI();
            pendingGoto = 'add-moment';
            showScreen('login');
            showFormError('login-error', 'Your session expired. Please log in again to add that moment.');
            return { ok: false };
        }
        if (!res.ok) {
            const err = await res.json().catch(() => null);
            return { ok: false, error: err?.error || 'Could not add that moment. Please try again.' };
        }
        const data = await res.json();
        refreshCapsules(); 
        return { ok: true, momentsCount: data.momentsCount };
    } catch (e) {
        return { ok: false, error: 'Network error. Please try again.' };
    }
}


const mbDropzone = document.getElementById('mb-dropzone');
const mbInput = document.getElementById('mb-input');
if (mbDropzone && mbInput) {
    mbDropzone.addEventListener('click', () => mbInput.click());
    mbInput.addEventListener('change', () => {
        const incoming = Array.from(mbInput.files || []);
        selectedMemoryBoxFiles = [...selectedMemoryBoxFiles, ...incoming].slice(0, 20);
        mbInput.value = '';
        renderFileChips('mb');
    });
}

const startMbBtn = document.getElementById('start-memory-box-btn');
const mbForm = document.getElementById('memory-box-form');
const mbCancelBtn = document.getElementById('mb-cancel');
const mbSubmitBtn = document.getElementById('mb-submit');
const mbEnvelope = document.getElementById('mb-envelope');
const mbEnvelopeFront = document.getElementById('mb-envelope-front');

function resetMemoryBoxForm() {
    selectedMemoryBoxFiles = [];
    renderFileChips('mb');
    const dateEl = document.getElementById('mb-end-date');
    if (dateEl) dateEl.value = '';
    const timeEl = document.getElementById('mb-end-time');
    if (timeEl) timeEl.value = '';
    clearFormError('mb-error');
}


function openMemoryBoxEnvelope() {
    if (mbEnvelope) mbEnvelope.classList.add('open');
    if (mbEnvelopeFront) mbEnvelopeFront.style.display = 'none';
    if (mbForm) {
        mbForm.style.display = 'block';
        requestAnimationFrame(() => requestAnimationFrame(() => mbForm.classList.add('show')));
    }
}

function closeMemoryBoxEnvelope() {
    if (mbForm) {
        mbForm.classList.remove('show');
        setTimeout(() => { mbForm.style.display = 'none'; }, 380);
    }
    if (mbEnvelope) mbEnvelope.classList.remove('open');
    if (mbEnvelopeFront) mbEnvelopeFront.style.display = '';
}

if (startMbBtn && mbForm) {
    startMbBtn.addEventListener('click', () => {
        if (!getToken()) { pendingGoto = 'add-moment'; showScreen('login'); return; }
        const dateEl = document.getElementById('mb-end-date');
        if (dateEl) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            dateEl.min = tomorrow.toISOString().slice(0, 10);
        }
        openMemoryBoxEnvelope();
    });
}
if (mbCancelBtn && mbForm) {
    mbCancelBtn.addEventListener('click', () => {
        resetMemoryBoxForm();
        closeMemoryBoxEnvelope();
    });
}

if (mbSubmitBtn) {
    mbSubmitBtn.addEventListener('click', async () => {
        clearFormError('mb-error');

        const dateEl = document.getElementById('mb-end-date');
        const timeEl = document.getElementById('mb-end-time');
        const dateVal = dateEl ? dateEl.value : '';
        if (!dateVal) { showFormError('mb-error', 'Pick an end date.'); return; }
        const timeVal = timeEl && timeEl.value ? timeEl.value : '23:59';
        const endLocal = new Date(dateVal + 'T' + timeVal);
        if (isNaN(endLocal.getTime()) || endLocal <= new Date()) {
            showFormError('mb-error', 'The end date/time has to be in the future.');
            return;
        }
        if (selectedMemoryBoxFiles.length === 0) {
            showFormError('mb-error', 'Upload at least one photo or video to get started.');
            return;
        }

        const formData = new FormData();
        formData.append('type', 'moments');
        formData.append('messageText', '');
        formData.append('recipientType', 'me');
        formData.append('recipientName', '');
        formData.append('recipientEmail', '');
        formData.append('unlockAtUtc', endLocal.toISOString());
        selectedMemoryBoxFiles.forEach(f => formData.append('files', f));

        mbSubmitBtn.disabled = true;
        try {
            const res = await fetch(API_BASE + '/api/capsules', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + getToken() },
                body: formData
            });
            if (res.status === 401) {
                clearAuth();
                refreshAuthUI();
                pendingGoto = 'add-moment';
                showScreen('login');
                showFormError('login-error', 'Your session expired. Please log in again to start your Memory Box.');
                return;
            }
            if (!res.ok) {
                const err = await res.json().catch(() => null);
                showFormError('mb-error', err?.error || 'Could not start your Memory Box. Please try again.');
                return;
            }

            resetMemoryBoxForm();
            closeMemoryBoxEnvelope();
            loadMomentsScreen();
            refreshCapsules();
        } catch (e) {
            showFormError('mb-error', 'Network error. Please try again.');
        } finally {
            mbSubmitBtn.disabled = false;
        }
    });
}


async function loadMomentsScreen() {
    const list = document.getElementById('moments-list');
    const empty = document.getElementById('moments-empty');
    if (!list) return;

    list.innerHTML = '<p style="color:var(--ink-soft);">Loading your moments capsules…</p>';

    try {
        const res = await apiFetch('/api/capsules');
        if (!res.ok) { list.innerHTML = ''; return; }
        const items = await res.json();
        const openCapsules = items.filter(c => c.type === 'moments' && !c.isSent && new Date(c.unlockAtUtc) > new Date());

        list.innerHTML = '';

        if (openCapsules.length === 0) {
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';

        openCapsules.forEach(capsule => {
            const row = document.createElement('div');
            row.className = 'capsule-card';
            row.style.marginBottom = '18px';
            const mediaCount = (capsule.mediaPaths || []).length;
            const inputId = 'moment-add-input-' + capsule.id;

            row.innerHTML = `
                <div class="capsule-icon">📸</div>
                <div class="capsule-title">${capsule.recipientType === 'other' ? 'For ' + escapeHtml(capsule.recipientName || capsule.recipientEmail) : 'For me'}</div>
                <div class="capsule-desc">${mediaCount} moment${mediaCount === 1 ? '' : 's'} so far · opens ${formatCapsuleDate(capsule.unlockAtUtc)}</div>
                <div style="margin-top:16px;">
                    <button class="btn btn-solid" type="button" data-add-moment="${capsule.id}">+ Add photos or videos</button>
                    <input type="file" id="${inputId}" accept="image/*,video/*" multiple style="display:none;">
                    <span class="dz-sub" data-moment-status="${capsule.id}" style="display:block; margin-top:8px;"></span>
                </div>`;
            list.appendChild(row);

            const input = row.querySelector('#' + inputId);
            const btn = row.querySelector('[data-add-moment]');
            const status = row.querySelector('[data-moment-status]');
            btn.addEventListener('click', () => input.click());
            input.addEventListener('change', async () => {
                if (!input.files || input.files.length === 0) return;
                status.textContent = 'Uploading…';
                const result = await addMomentsToCapsule(capsule.id, input.files);
                input.value = '';
                if (result.ok) {
                    status.textContent = `Added! ${result.momentsCount} moment${result.momentsCount === 1 ? '' : 's'} sealed so far.`;
                    loadMomentsScreen(); 
                } else {
                    status.textContent = result.error || 'Something went wrong.';
                }
            });
        });
    } catch (e) {
        list.innerHTML = '<p style="color:var(--ink-soft);">Couldn\'t load your moments capsules. Try again in a bit.</p>';
    }
}

const TYPE_ICON = { message: '✉️', photo: '🖼️', voice: '🎙️', video: '🎬', moments: '📸' };
const TYPE_LABEL = { message: 'Message', photo: 'Photo capsule', voice: 'Voice note', video: 'Video', moments: 'Moments collection' };


const TEASER_SEALED = {
    message: 'A few words are sealed inside, waiting for their moment.',
    photo: 'A picture is tucked away in here, waiting for the light.',
    voice: 'A voice is resting inside, waiting to be heard again.',
    video: 'A moment is sealed away, waiting to unfold.',
    moments: 'A handful of moments are sealed away, waiting to come together.'
};
const TEASER_READY = {
    message: 'The words are ready whenever you are.',
    photo: 'A memory has found its way back to you.',
    voice: 'A voice from the past is ready to speak again.',
    video: 'A moment has come back around, ready to relive.',
    moments: 'A collection of moments is ready to relive.'
};

function formatCapsuleDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function refreshCapsules() {
    const grid = document.getElementById('capsule-grid');
    const emptyState = document.getElementById('capsule-empty');
    if (!grid || !getToken()) return;

    try {
        const res = await apiFetch('/api/capsules');
        if (!res.ok) return;
        const items = await res.json();

        grid.querySelectorAll('.capsule-card').forEach(c => c.remove());

        if (!items.length) {
            if (emptyState) emptyState.style.display = '';
            return;
        }
        if (emptyState) emptyState.style.display = 'none';

        items.forEach((capsule, index) => {
            const isReady = capsule.isSent || new Date(capsule.unlockAtUtc) <= new Date();
            const card = document.createElement('div');
            card.className = 'capsule-card';

           
            const tiltSign = index % 2 === 0 ? -1 : 1;
            const tiltDeg = (tiltSign * (1.6 + (index % 3) * 0.5)).toFixed(1);
            const shadowX = (tiltSign * 8) + 'px';
            card.style.setProperty('--tilt', tiltDeg + 'deg');
            card.style.setProperty('--tilt-shadow-x', shadowX);

            card.innerHTML = `
                <div class="tape tape-variant-${index % 3}"></div>
                <div class="capsule-icon">${TYPE_ICON[capsule.type] || '✉️'}</div>
                <div class="status-badge ${isReady ? 'unlocked' : 'locked'}">${isReady ? 'Unlocked' : 'Locked'}</div>
                <div class="capsule-title">${TYPE_LABEL[capsule.type] || 'Capsule'}</div>
                <div class="capsule-desc">${(isReady ? TEASER_READY : TEASER_SEALED)[capsule.type] || (isReady ? TEASER_READY.message : TEASER_SEALED.message)}</div>
                <div class="capsule-meta">
                    <span class="for">${capsule.recipientType === 'other' ? 'For ' + escapeHtml(capsule.recipientName || capsule.recipientEmail) : 'For me'}</span>
                    <span class="date ${isReady ? 'ready' : ''}">${isReady ? 'Opened' : 'Opens'} ${formatCapsuleDate(capsule.unlockAtUtc)}</span>
                </div>`;
            grid.appendChild(card);
        });
    } catch (e) {
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

refreshAuthUI();
if (getToken()) {
    refreshCapsules();
} else {
    
    showScreen('register');
}


const envOverlay = document.getElementById('envelope-overlay');
const envReveal = document.getElementById('envelope-reveal');
const envContent = document.getElementById('env-content');
const envClose = document.getElementById('envelope-close');
const envSealed = document.getElementById('env-sealed');
const envOpen = document.getElementById('env-open');
const envBgBlur = document.getElementById('env-bg-blur');
const envParticles = document.getElementById('env-particles');
const envMuteBtn = document.getElementById('envelope-mute');


const envSound = (() => {
    let ctx = null;
    let muted = localStorage.getItem('mb_muted') === '1';

    function getCtx() {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) ctx = new AC();
        }
        if (ctx && ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    function noiseBurst({ duration = 0.18, filterFreq = 1200, gain = 0.18, type = 'lowpass' } = {}) {
        if (muted) return;
        const ac = getCtx();
        if (!ac) return;
        const bufferSize = Math.floor(ac.sampleRate * duration);
        const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        const src = ac.createBufferSource();
        src.buffer = buffer;
        const filter = ac.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = filterFreq;
        const g = ac.createGain();
        g.gain.setValueAtTime(gain, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
        src.connect(filter).connect(g).connect(ac.destination);
        src.start();
    }

    function tone({ freq = 600, duration = 0.12, gain = 0.12, type = 'sine', slideTo = null } = {}) {
        if (muted) return;
        const ac = getCtx();
        if (!ac) return;
        const osc = ac.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, ac.currentTime);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + duration);
        const g = ac.createGain();
        g.gain.setValueAtTime(gain, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
        osc.connect(g).connect(ac.destination);
        osc.start();
        osc.stop(ac.currentTime + duration + 0.02);
    }

    return {
        waxCrack: () => { noiseBurst({ duration: 0.14, filterFreq: 2200, gain: 0.22, type: 'highpass' }); tone({ freq: 180, duration: 0.09, gain: 0.1, type: 'square' }); },
        paperRustle: () => noiseBurst({ duration: 0.5, filterFreq: 1800, gain: 0.1, type: 'bandpass' }),
        pop: () => tone({ freq: 520, duration: 0.16, gain: 0.14, type: 'sine', slideTo: 880 }),
        isMuted: () => muted,
        setMuted: (v) => { muted = v; localStorage.setItem('mb_muted', v ? '1' : '0'); }
    };
})();

function updateMuteButton() {
    if (!envMuteBtn) return;
    const muted = envSound.isMuted();
    envMuteBtn.textContent = muted ? '🔇' : '🔊';
    envMuteBtn.classList.toggle('muted', muted);
    envMuteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
}
updateMuteButton();
if (envMuteBtn) envMuteBtn.addEventListener('click', () => {
    envSound.setMuted(!envSound.isMuted());
    updateMuteButton();
});

function spawnEnvParticles() {
    if (!envParticles || envParticles.dataset.spawned) return;
    envParticles.dataset.spawned = '1';
    const count = 26;
    for (let i = 0; i < count; i++) {
        const p = document.createElement('span');
        p.className = 'env-particle';
        p.style.left = Math.random() * 100 + '%';
        p.style.bottom = -(Math.random() * 20) + 'px';
        const duration = 9 + Math.random() * 10;
        p.style.animationDuration = duration + 's';
        p.style.animationDelay = -(Math.random() * duration) + 's';
        p.style.opacity = String(0.25 + Math.random() * 0.35);
        p.style.width = p.style.height = (2 + Math.random() * 2) + 'px';
        envParticles.appendChild(p);
    }
}

function openCapsuleReveal({ title = 'Untitled memory', eyebrow = 'Opened today', body = '', galleryItems = [], arrivedToday = false } = {}) {
    envContent.innerHTML = `
        <div class="env-content-eyebrow">${eyebrow}</div>
        <div class="env-content-title">${title}</div>
        ${buildGalleryHtml(galleryItems)}
        <div class="env-content-body">${body}</div>
    `;
    envReveal.classList.remove('opening', 'unsealed', 'arrived-today', 'seal-shake', 'seal-drop');
    if (envSealed) envSealed.style.display = '';
    if (envBgBlur) { envBgBlur.classList.remove('show'); envBgBlur.style.backgroundImage = ''; }

    if (arrivedToday) envReveal.classList.add('arrived-today');

    envOverlay.classList.add('show');
    spawnEnvParticles();
    const firstVisual = galleryItems.find(g => g.type === 'image' || g.type === 'video');
    envReveal.dataset.bgSrc = (firstVisual && firstVisual.type === 'image') ? firstVisual.src : '';

    requestAnimationFrame(() => {
        requestAnimationFrame(() => envReveal.classList.add('opening'));
    });
}


function unsealCapsuleEnvelope() {
    if (!envReveal || envReveal.classList.contains('unsealed') || envReveal.classList.contains('seal-shake') || envReveal.classList.contains('seal-drop')) return;

    envReveal.classList.add('seal-shake');
    envSound.paperRustle();

    setTimeout(() => {
        envReveal.classList.remove('seal-shake');
        envReveal.classList.add('seal-drop');
        envSound.waxCrack();
    }, 400);

    setTimeout(() => {
        envReveal.classList.add('unsealed');
        if (envBgBlur && envReveal.dataset.bgSrc) {
            envBgBlur.style.backgroundImage = `url("${envReveal.dataset.bgSrc}")`;
            envBgBlur.classList.add('show');
        }
    }, 760);

    setTimeout(() => envSound.pop(), 1180);

    setTimeout(() => {
        requestAnimationFrame(() => requestAnimationFrame(() => initCapsuleGalleries(envContent)));
    }, 1260);
}

if (envSealed) envSealed.addEventListener('click', unsealCapsuleEnvelope);


function buildGalleryHtml(items) {
    if (!items || items.length === 0) return '';
    const slides = items.map((item, i) => {
        const inner = item.type === 'video'
            ? `<video src="${item.src}" controls playsinline></video>`
            : `<img src="${item.src}" alt="">`;
        return `<div class="capsule-gallery-item" data-index="${i}">${inner}</div>`;
    }).join('');
    const nav = items.length > 1
        ? `<button type="button" class="capsule-gallery-nav prev" aria-label="Previous moment">‹</button>
           <button type="button" class="capsule-gallery-nav next" aria-label="Next moment">›</button>`
        : '';
    const dots = items.length > 1
        ? `<div class="capsule-gallery-dots">${items.map((_, i) => `<span class="capsule-gallery-dot${i === 0 ? ' active' : ''}" data-dot="${i}"></span>`).join('')}</div>`
        : '';
    const caption = items.length > 1
        ? `<p class="capsule-gallery-caption">${items.length} moments — drag or scroll to turn through them</p>`
        : '';
    return `
        <div class="capsule-gallery-wrap" data-gallery>
            ${nav}
            <div class="capsule-gallery">${slides}</div>
        </div>
        ${dots}
        ${caption}
    `;
}


function fitCapsuleGalleryItem(itemEl, onSized) {
    const media = itemEl.querySelector('img, video');
    if (!media) return;

    const maxW = Math.min(340, window.innerWidth * 0.66);
    const maxH = 380;
    const minW = 200;
    const minH = 200;

    function apply(naturalW, naturalH) {
        if (!naturalW || !naturalH) return;
        const ratio = naturalW / naturalH;
        let w = maxW;
        let h = w / ratio;
        if (h > maxH) {
            h = maxH;
            w = h * ratio;
        }
        w = Math.max(minW, Math.min(maxW, w));
        h = Math.max(minH, Math.min(maxH, h));
        itemEl.style.width = `${w}px`;
        itemEl.style.height = `${h}px`;
        if (typeof onSized === 'function') onSized();
    }

    if (media.tagName === 'IMG') {
        if (media.complete && media.naturalWidth) {
            apply(media.naturalWidth, media.naturalHeight);
        } else {
            media.addEventListener('load', () => apply(media.naturalWidth, media.naturalHeight), { once: true });
        }
    } else {
        if (media.readyState >= 1 && media.videoWidth) {
            apply(media.videoWidth, media.videoHeight);
        } else {
            media.addEventListener('loadedmetadata', () => apply(media.videoWidth, media.videoHeight), { once: true });
        }
    }
}


function initCapsuleGalleries(root) {
    root.querySelectorAll('[data-gallery]').forEach(wrap => {
        const track = wrap.querySelector('.capsule-gallery');
        const items = [...wrap.querySelectorAll('.capsule-gallery-item')];
        const dots = [...wrap.parentElement.querySelectorAll('.capsule-gallery-dot')];
        const prevBtn = wrap.querySelector('.capsule-gallery-nav.prev');
        const nextBtn = wrap.querySelector('.capsule-gallery-nav.next');
        if (!track || items.length === 0 || track.dataset.wheelInit) return;
        track.dataset.wheelInit = '1';

        let activeIndex = 0;

        items.forEach(item => fitCapsuleGalleryItem(item, update));
        window.addEventListener('resize', () => items.forEach(item => fitCapsuleGalleryItem(item, update)));

        function update() {
            const trackRect = track.getBoundingClientRect();
            if (trackRect.width === 0) return;
            const center = trackRect.left + trackRect.width / 2;
            let closestIdx = 0, closestDist = Infinity;
            items.forEach((item, i) => {
                const r = item.getBoundingClientRect();
                const itemCenter = r.left + r.width / 2;
                const dist = (itemCenter - center) / trackRect.width;
                const abs = Math.min(Math.abs(dist), 1.5);
                const scale = 1 - abs * 0.34;
                const rotate = dist * 28;
                const opacity = Math.max(0.15, 1 - abs * 0.65);
                const z = -abs * 180;
                item.style.transform = `translateZ(${z}px) rotateY(${-rotate}deg) scale(${scale})`;
                item.style.opacity = String(opacity);
                item.style.zIndex = String(100 - Math.round(abs * 100));
                if (Math.abs(dist) < closestDist) { closestDist = Math.abs(dist); closestIdx = i; }
            });
            if (closestIdx !== activeIndex) {
                activeIndex = closestIdx;
                dots.forEach((d, i) => d.classList.toggle('active', i === activeIndex));
            }
        }

        track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
        window.addEventListener('resize', update);
        update();

        function scrollToIndex(i) {
            const clamped = Math.max(0, Math.min(items.length - 1, i));
            items[clamped].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }

        if (prevBtn) prevBtn.addEventListener('click', () => scrollToIndex(activeIndex - 1));
        if (nextBtn) nextBtn.addEventListener('click', () => scrollToIndex(activeIndex + 1));
        dots.forEach((d, i) => d.addEventListener('click', () => scrollToIndex(i)));
    });
}

function closeCapsuleReveal() {
    envOverlay.classList.remove('show');
    envReveal.classList.remove('opening', 'unsealed', 'arrived-today', 'seal-shake', 'seal-drop');
    if (envSealed) envSealed.style.display = '';
    if (envBgBlur) { envBgBlur.classList.remove('show'); envBgBlur.style.backgroundImage = ''; }
}

if (envClose) envClose.addEventListener('click', closeCapsuleReveal);
if (envOverlay) envOverlay.addEventListener('click', (e) => {
    if (e.target === envOverlay) closeCapsuleReveal();
});


async function tryOpenSharedCapsuleFromLink() {
    const token = new URLSearchParams(window.location.search).get('view');
    if (!token) return;

    try {
        const res = await fetch(API_BASE + '/api/capsules/view/' + encodeURIComponent(token));

        if (res.status === 423) {
            const data = await res.json().catch(() => null);
            const when = data?.unlockAtUtc ? new Date(data.unlockAtUtc).toLocaleString() : 'later';
            openCapsuleReveal({
                eyebrow: 'Still sealed',
                title: 'Not yet.',
                body: `<p>This capsule unlocks on <strong>${when}</strong>. Come back then.</p>`
            });
            return;
        }
        if (!res.ok) {
            openCapsuleReveal({
                eyebrow: 'Not found',
                title: "This link doesn't work.",
                body: '<p>The capsule link is invalid or has expired.</p>'
            });
            return;
        }

        const capsule = await res.json();
        const { galleryItems, bodyHtml } = buildSharedCapsuleContent(capsule);
        const arrivedToday = isArrivingToday(capsule.unlockAtUtc);
        openCapsuleReveal({
            eyebrow: 'Opened ' + new Date(capsule.unlockAtUtc).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            title: capsule.recipientName ? `For ${escapeHtml(capsule.recipientName)}` : 'A memory for you',
            body: bodyHtml,
            galleryItems,
            arrivedToday
        });
    } catch (e) {

    }
}


function isArrivingToday(unlockAtUtc) {
    if (!unlockAtUtc) return false;
    const unlock = new Date(unlockAtUtc);
    const now = new Date();
    return unlock.getFullYear() === now.getFullYear()
        && unlock.getMonth() === now.getMonth()
        && unlock.getDate() === now.getDate();
}

function buildSharedCapsuleContent(capsule) {
    const videoExts = ['.mp4', '.mov', '.webm', '.m4v'];
    const galleryItems = [];
    let bodyHtml = '';

    if (capsule.messageText) {
        bodyHtml += `<p style="white-space:pre-wrap;">${escapeHtml(capsule.messageText)}</p>`;
    }

    (capsule.mediaPaths || []).forEach(path => {
        if (capsule.type === 'photo' || capsule.type === 'message') {
            galleryItems.push({ type: 'image', src: path });
        } else if (capsule.type === 'video') {
            galleryItems.push({ type: 'video', src: path });
        } else if (capsule.type === 'voice') {
            bodyHtml += `<div class="voice-player"><span class="voice-player-icon">🎙️</span><audio src="${path}" controls style="width:100%;"></audio></div>`;
        } else if (capsule.type === 'moments') {
            const isVideo = videoExts.some(ext => path.toLowerCase().includes(ext));
            galleryItems.push({ type: isVideo ? 'video' : 'image', src: path });
        }
    });

    if (!bodyHtml && galleryItems.length === 0) {
        bodyHtml = '<p>This capsule is empty.</p>';
    }

    return { galleryItems, bodyHtml };
}

tryOpenSharedCapsuleFromLink();


const imagineInner = document.querySelector('.imagine-inner');
if (imagineInner && 'IntersectionObserver' in window) {
    const imagineObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                imagineInner.classList.add('in-view');
                imagineObserver.unobserve(imagineInner);
            }
        });
    }, { threshold: 0.3 });
    imagineObserver.observe(imagineInner);
} else if (imagineInner) {
    imagineInner.classList.add('in-view');
}