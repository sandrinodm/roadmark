/**
 * Shows a chip's choice in the text visible before its select upgrades, and names the button after
 * it. Once upgraded, the select shows the value and names its trigger from the label.
 *
 * @param chip Chip.
 * @param text Visible choice.
 */
export function showChoice(chip: HTMLElement, text: string): void {
  const pending = chip.querySelector('.chip-pending');
  if (pending) {
    pending.textContent = text;
  }

  if (!customElements.get('ui-select')) {
    chip
      .querySelector('ui-select-trigger button')
      ?.setAttribute('aria-label', `${chip.dataset['label'] ?? ''}: ${text}`);
  }
}
