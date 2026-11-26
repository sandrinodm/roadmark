/**
 * Closes the narrow-screen menu (a `<details>`) on an outside press, on Escape and when focus
 * leaves it, as a menu would.
 */
export function connectMenu(): void {
  const menu = document.querySelector<HTMLDetailsElement>('details[data-collection-picker]');
  if (!menu) {
    return;
  }

  document.addEventListener('pointerdown', (event) => {
    if (menu.open && event.target instanceof Node && !menu.contains(event.target)) {
      menu.open = false;
    }
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) {
      event.preventDefault();
      menu.open = false;
      menu.querySelector('summary')?.focus();
    }
  });
  menu.addEventListener('focusout', (event) => {
    if (event.relatedTarget instanceof Node && !menu.contains(event.relatedTarget)) {
      menu.open = false;
    }
  });
}
