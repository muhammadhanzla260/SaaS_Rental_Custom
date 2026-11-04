/**
 * Shared page behaviour, driven by data attributes so pages stay plain HTML:
 *
 *  Choices   <div data-scope> … <div data-choice="gear"><button data-value="tent" aria-checked>…
 *            Picking sets scope.dataset.gear = "tent", updates aria-checked/aria-pressed and toggles
 *            `hidden` on every [data-when="gear:tent"] in the scope. Fires "rh:choice".
 *  Flips     .flip buttons toggle aria-pressed; [data-flip-all] flips every card in its scope.
 *  Tours     [data-tour="5500"] with [role=tab] buttons: auto-advances, pauses on any click,
 *            while the tab is hidden, and while the tour is off screen.
 */

export function choose(scope: HTMLElement, key: string, value: string, user = true) {
  scope.dataset[key] = value;
  scope.querySelectorAll<HTMLElement>(`[data-choice="${key}"] [data-value]`).forEach((b) => {
    const on = b.dataset.value === value;
    b.setAttribute(b.getAttribute('role') === 'tab' ? 'aria-selected' : b.hasAttribute('aria-pressed') ? 'aria-pressed' : 'aria-checked', String(on));
    if (b.getAttribute('role') === 'tab') b.tabIndex = on ? 0 : -1;
  });
  scope.querySelectorAll<HTMLElement>('[data-when]').forEach((el) => {
    const conds = el.dataset.when!.split(' ').filter((c) => c.startsWith(`${key}:`));
    if (conds.length) el.hidden = !conds.includes(`${key}:${value}`);
  });
  scope.dispatchEvent(new CustomEvent('rh:choice', { bubbles: true, detail: { key, value, user } }));
}

const scopeOf = (el: Element) => el.closest<HTMLElement>('[data-scope]') ?? document.body;

document.addEventListener('click', (e) => {
  const t = e.target as Element;
  const opt = t.closest<HTMLElement>('[data-choice] [data-value]');
  if (opt) {
    const group = opt.closest<HTMLElement>('[data-choice]')!;
    choose(scopeOf(group), group.dataset.choice!, opt.dataset.value!);
    return;
  }
  const flip = t.closest<HTMLButtonElement>('button.flip');
  if (flip) { flip.setAttribute('aria-pressed', String(flip.getAttribute('aria-pressed') !== 'true')); return; }
  const all = t.closest<HTMLButtonElement>('[data-flip-all]');
  if (all) {
    const cards = [...scopeOf(all).querySelectorAll<HTMLButtonElement>('button.flip')];
    const to = !cards.every((c) => c.getAttribute('aria-pressed') === 'true');
    cards.forEach((c) => c.setAttribute('aria-pressed', String(to)));
    all.textContent = to ? all.dataset.on ?? 'Undo' : all.dataset.off ?? 'Flip all';
  }
});

// Arrow keys move between options in a radiogroup / tablist.
document.addEventListener('keydown', (e) => {
  if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
  const opt = (e.target as Element).closest<HTMLElement>('[data-choice] [data-value]');
  if (!opt) return;
  const group = opt.closest<HTMLElement>('[data-choice]')!;
  if (!['radiogroup', 'tablist'].includes(group.getAttribute('role') ?? '')) return;
  const opts = [...group.querySelectorAll<HTMLElement>('[data-value]')];
  const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
  const next = opts[(opts.indexOf(opt) + dir + opts.length) % opts.length]!;
  e.preventDefault();
  next.focus();
  next.click();
});

// Choices can be preset from the URL: ?gear=tent picks gear "tent" wherever that choice exists.
const q = new URLSearchParams(location.search);
document.querySelectorAll<HTMLElement>('[data-choice][data-url]').forEach((g) => {
  const v = q.get(g.dataset.choice!);
  if (v && g.querySelector(`[data-value="${CSS.escape(v)}"]`)) choose(scopeOf(g), g.dataset.choice!, v, false);
});

document.querySelectorAll<HTMLElement>('[data-tour]').forEach((tour) => {
  const ms = Number(tour.dataset.tour) || 5500;
  const group = tour.querySelector<HTMLElement>('[data-choice]')!;
  const key = group.dataset.choice!;
  const values = [...group.querySelectorAll<HTMLElement>('[data-value]')].map((b) => b.dataset.value!);
  let paused = false;
  let visible = false;
  let timer = 0;
  const run = () => {
    clearInterval(timer);
    tour.dataset.paused = String(paused || !visible || document.hidden);
    if (paused || !visible || document.hidden) return;
    timer = window.setInterval(() => {
      const i = values.indexOf(tour.dataset[key] ?? values[0]!);
      choose(tour, key, values[(i + 1) % values.length]!, false);
    }, ms);
  };
  tour.addEventListener('rh:choice', (e) => {
    if ((e as CustomEvent).detail.user) { paused = true; run(); }
  });
  tour.addEventListener('pointerdown', () => { paused = true; run(); });
  document.addEventListener('visibilitychange', run);
  new IntersectionObserver(([en]) => { visible = !!en?.isIntersecting; run(); }, { threshold: 0.25 }).observe(tour);
});
