// Development fallback: slot 0 WASD + left Shift, slot 1 arrows + Enter.
// A slot becomes "active" the first time one of its keys is pressed.
// Axes follow the pad: x right positive, y up (forward, downhill) positive.

const MAPS = [
  { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], boost: ['ShiftLeft'] },
  { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], boost: ['Enter', 'NumpadEnter'] },
];

export function createKeyboard(target = globalThis.window) {
  const down = new Set();
  const active = [false, false];
  const taps = [false, false];
  const owner = new Map();
  MAPS.forEach((m, slot) => { for (const k of Object.values(m).flat()) owner.set(k, slot); });

  const onDown = (e) => {
    const slot = owner.get(e.code);
    if (slot === undefined) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '')) return;
    active[slot] = true;
    if (MAPS[slot].boost.includes(e.code) && !down.has(e.code)) taps[slot] = true;
    down.add(e.code);
    if (e.code.startsWith('Arrow')) e.preventDefault?.();
  };
  const onUp = (e) => { down.delete(e.code); };
  const onBlur = () => down.clear();

  if (target?.addEventListener) {
    target.addEventListener('keydown', onDown);
    target.addEventListener('keyup', onUp);
    target.addEventListener('blur', onBlur);
  }

  const any = (keys) => keys.some((k) => down.has(k));

  return {
    active(slot) { return !!active[slot]; },
    // {x, y, boost} for an active slot, null otherwise. A boost tap shorter than a frame still counts once.
    get(slot) {
      const m = MAPS[slot];
      if (!m || !active[slot]) return null;
      let x = (any(m.right) ? 1 : 0) - (any(m.left) ? 1 : 0);
      let y = (any(m.up) ? 1 : 0) - (any(m.down) ? 1 : 0);
      if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
      const boost = any(m.boost) || taps[slot];
      taps[slot] = false;
      return { x, y, boost };
    },
    dispose() {
      if (!target?.removeEventListener) return;
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}
