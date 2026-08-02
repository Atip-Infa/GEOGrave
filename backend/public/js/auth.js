import { login } from './api.js';
import { showToast } from './toast.js';

const authModal = document.getElementById('auth-modal');
const authBtn = document.getElementById('auth-btn');
const authForm = document.getElementById('auth-form');
const authError = document.getElementById('auth-error');
const authModalClose = document.getElementById('auth-modal-close');
const authSubmit = document.getElementById('auth-submit');

function openAuthModal() {
  authError.textContent = '';
  authModal.classList.remove('hidden');
  document.getElementById('auth-username').focus();
}
function closeAuthModal() {
  authModal.classList.add('hidden');
  authBtn.focus();
}

export function initAuth(store) {
  // Render: reflect auth state in the nav button. This is the ONLY place
  // that writes to authBtn, and it runs every time the store changes -
  // no other module needs to remember to keep it in sync.
  store.subscribe(({ authToken, authUsername }) => {
    const isAuthed = !!authToken;
    authBtn.textContent = isAuthed ? `ออกจากระบบ (${authUsername})` : 'เข้าสู่ระบบเจ้าหน้าที่';
    authBtn.classList.toggle('logged-in', isAuthed);
  });

  authBtn.addEventListener('click', () => {
    const { authToken } = store.getState();
    if (authToken) {
      sessionStorage.removeItem('geograve_token');
      sessionStorage.removeItem('geograve_username');
      store.setState({ authToken: null, authUsername: null });
      showToast('ออกจากระบบแล้ว', 'info');
    } else {
      openAuthModal();
    }
  });

  authModalClose.addEventListener('click', closeAuthModal);
  authModal.addEventListener('click', (e) => { if (e.target === authModal) closeAuthModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !authModal.classList.contains('hidden')) closeAuthModal();
  });

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(authForm);
    authSubmit.disabled = true;
    authError.textContent = '';
    try {
      const data = await login(formData.get('username'), formData.get('password'));
      sessionStorage.setItem('geograve_token', data.token);
      sessionStorage.setItem('geograve_username', data.username);
      store.setState({ authToken: data.token, authUsername: data.username });
      authForm.reset();
      closeAuthModal();
      showToast('เข้าสู่ระบบสำเร็จ', 'success');
    } catch (err) {
      authError.textContent = err.message;
    } finally {
      authSubmit.disabled = false;
    }
  });

  // A failed/expired-token API call (e.g. delete after the 8h session
  // lapses) calls this to force the UI back to a logged-out state.
  return {
    promptLogin() {
      openAuthModal();
    },
    forceLogout() {
      sessionStorage.removeItem('geograve_token');
      sessionStorage.removeItem('geograve_username');
      store.setState({ authToken: null, authUsername: null });
      openAuthModal();
    }
  };
}
