(() => {
    const key = 'SHIROKO_THEME';
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const valid = value => ['light', 'dark', 'system'].includes(value);
    let preference = 'system';
    let button;
    try { const saved = localStorage.getItem(key); if (valid(saved)) preference = saved; } catch {}
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet'; stylesheet.href = '/theme-toggle.css'; document.head.append(stylesheet);
    function apply() {
        const theme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.themePreference = preference;
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = theme === 'dark' ? '#10212b' : '#f5f8fa';
        if (button) {
            const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
            button.setAttribute('aria-label', label); button.title = label;
            button.setAttribute('aria-pressed', String(theme === 'dark'));
            button.innerHTML = theme === 'dark'
                ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>'
                : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.9 13.1A9 9 0 0 1 10.9 3.1a9 9 0 1 0 10 10Z"/></svg>';
        }
    }
    apply();
    system.addEventListener('change', () => { if (preference === 'system') apply(); });
    window.addEventListener('storage', event => {
        if (event.key === key || event.key === null) { preference = valid(event.newValue) ? event.newValue : 'system'; apply(); }
    });
    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('.theme-control, .theme-select').forEach(element => element.remove());
        button = document.createElement('button'); button.type = 'button'; button.className = 'theme-toggle';
        button.addEventListener('click', () => {
            preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
            try { localStorage.setItem(key, preference); } catch {}
            apply();
        });
        document.body.append(button); apply();
    });
})();
