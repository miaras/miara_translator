import { t } from './interface-i18n.js';

let userId = null;
let checking = false;
let dialog = null;
let pending = [];
let acknowledging = [];

async function acknowledge() {
    if (!acknowledging.length) return;
    const ids = [...acknowledging];
    const response = await fetch('/api/referrals/notifications', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
    });
    if (!response.ok) throw new Error('Referral notification acknowledgement failed');
    acknowledging = acknowledging.filter(id => !ids.includes(id));
}

function showNext() {
    if (!userId || dialog || !pending.length || document.querySelector('dialog[open]')) return;
    const notification = pending.shift();
    const account = userId;
    dialog = document.createElement('dialog');
    dialog.className = 'auth-dialog';
    dialog.dataset.noLocalize = '';
    dialog.setAttribute('aria-labelledby', 'referral-reward-heading');
    const heading = document.createElement('h2');
    heading.id = 'referral-reward-heading';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-dark';
    const localize = () => {
        heading.textContent = t('You got 2,500 referral credits!');
        button.textContent = t('Continue');
    };
    localize();
    window.addEventListener('interface-language-change', localize);
    button.addEventListener('click', () => dialog?.close());
    dialog.append(heading, button);
    dialog.addEventListener('close', () => {
        window.removeEventListener('interface-language-change', localize);
        dialog.remove();
        dialog = null;
        if (userId === account) {
            acknowledging.push(notification.id);
            void acknowledge().then(showNext).catch(() => {});
        }
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
}

async function check() {
    if (!userId || checking || document.visibilityState === 'hidden') return;
    checking = true;
    const account = userId;
    try {
        await acknowledge();
        const response = await fetch('/api/referrals/notifications', { credentials: 'same-origin' });
        if (!response.ok) return;
        const data = await response.json();
        if (account !== userId || dialog) return;
        pending = data.notifications.filter(item => item.creditTokens === 2500);
        showNext();
    } catch {} finally { checking = false; }
}

window.addEventListener('shiroko:account', event => {
    const next = event.detail.user?.id || null;
    if (next !== userId) {
        userId = next;
        pending = [];
        acknowledging = [];
        dialog?.close();
    }
    void check();
});
document.addEventListener('close', () => setTimeout(showNext, 0), true);
document.addEventListener('visibilitychange', () => void check());
window.addEventListener('focus', () => void check());
setInterval(() => void check(), 60_000);
