import languages from './languages.json';
import headline from './headline-translations.json';

const track = document.getElementById('headline-track');
const viewport = document.getElementById('headline-viewport');
const pauseButton = document.getElementById('headline-pause');

if (track && viewport && pauseButton) {
    const group = document.createElement('div');
    group.className = 'headline-group';
    const carouselLanguages = languages.filter(language => language.code !== 'en');
    for (const language of carouselLanguages) {
        const slide = document.createElement('div');
        slide.className = 'headline-slide';
        const text = document.createElement('p');
        text.className = 'example-target';
        text.lang = language.code;
        text.dir = language.dir;
        text.textContent = headline.translations[language.code];
        slide.append(text);
        group.append(slide);
    }
    const duplicate = group.cloneNode(true);
    duplicate.setAttribute('aria-hidden', 'true');
    duplicate.inert = true;
    track.replaceChildren(group, duplicate);
    track.style.setProperty('--headline-duration', `${carouselLanguages.length * 5}s`);
    pauseButton.hidden = false;
    pauseButton.addEventListener('click', () => {
        const paused = viewport.classList.toggle('is-paused');
        pauseButton.setAttribute('aria-pressed', String(paused));
        pauseButton.textContent = paused ? 'Resume scrolling' : 'Pause scrolling';
    });
}
