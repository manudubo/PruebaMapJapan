import { describe, it, expect, vi } from 'vitest';
import { setText, setStyle } from '@/modules/dom';

describe('setText', () => {
  it('sets textContent on an Element', () => {
    const el = document.createElement('div');
    setText(el, 'hello');
    expect(el.textContent).toBe('hello');
  });

  it('does not set innerHTML', () => {
    const el = document.createElement('div');
    const spy = vi.spyOn(el, 'innerHTML', 'set');
    setText(el, 'safe');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('setStyle', () => {
  it('calls style.setProperty with the given prop and value', () => {
    const el = document.createElement('div');
    const spy = vi.spyOn(el.style, 'setProperty');
    setStyle(el, 'background-image', "url('/img.jpg')");
    expect(spy).toHaveBeenCalledWith('background-image', "url('/img.jpg')");
  });

  it('does not set style via innerHTML', () => {
    const el = document.createElement('div');
    const spy = vi.spyOn(el, 'innerHTML', 'set');
    setStyle(el, 'color', 'red');
    expect(spy).not.toHaveBeenCalled();
  });
});
