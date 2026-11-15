// Keyboard and mouse, and the pointer lock that turns the mouse into look.
// Plain browser APIs only: the game asks the canvas for pointer lock and reads
// movementX/Y while it holds it. The sim reads keys from `state.keys` (a Set of
// event.code strings: KeyW, KeyR, KeyC, Space, KeyE, Digit1 ... Digit6, KeyB,
// KeyG, ControlLeft ...) once per fixed step; edge-triggered actions (reload,
// buy, throw, weapon select) are reported through takePressed(), which returns
// the codes pressed since the last call and clears the list, so main.js never
// fires twice on one keypress. The mouse wheel cycles weapons via onWheel(cb),
// which main.js sets to its own select-next/previous handler.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = [];
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0 };
  let wheelHandler = null;

  function setKey(event, down) {
    if (down) {
      if (!event.repeat) pressed.push(event.code);
      keys.add(event.code);
    } else {
      keys.delete(event.code);
    }
    // Space scrolls the page and Ctrl+W closes the tab — neither may happen mid-game.
    if (event.code === 'Space') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => {
    keys.clear();
    state.firing = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (state.locked && event.button === 0) state.firing = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  window.addEventListener('wheel', (event) => {
    if (!state.locked || !wheelHandler) return;
    event.preventDefault();
    wheelHandler(event.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
    }
    if (onLockChange) onLockChange(state.locked);
  });
  // Right-click does nothing in this game; keep the menu from stealing the lock.
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    // Consume and clear the accumulated mouse deltas since the last call.
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    // Codes pressed since the last takePressed() call, in order (no repeats).
    takePressed() {
      const out = pressed.slice();
      pressed.length = 0;
      return out;
    },
    // Main sets this to cycle the weapon selection: cb(1) = next, cb(-1) = previous.
    onWheel(handler) {
      wheelHandler = handler;
    },
  };
}
