const video = document.getElementById('product-video');
if (video) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    video.defaultMuted = true;
    video.muted = true;
    function updateAutoplay() {
        video.autoplay = !reducedMotion.matches;
        if (reducedMotion.matches) {
            video.pause();
        } else {
            // Native controls remain available if the browser blocks autoplay.
            video.play().catch(() => {});
        }
    }
    updateAutoplay();
    reducedMotion.addEventListener('change', updateAutoplay);
}
