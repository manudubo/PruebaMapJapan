export function setText(el: Element, text: string): void {
  el.textContent = text;
}

export function setStyle(el: HTMLElement, prop: string, value: string): void {
  el.style.setProperty(prop, value);
}
