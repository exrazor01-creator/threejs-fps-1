// Keyboard and mouse, and the pointer lock that turns the mouse into look.
// Plain browser APIs only: the game asks the canvas for pointer lock and reads
// movementX/Y while it holds it. When the lock is not held (menus, buy phase),
// mouse drag on the canvas still looks around, so the game stays testable and
// playable without a lock grab.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0 };
  let dragging = false;

  function setKey(event, down) {
    if (down) keys.add(event.code);
    else keys.delete(event.code);
    if (event.code === 'Space' || event.code === 'Tab') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => {
    keys.clear();
    state.firing = false;
    dragging = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (state.locked) {
      state.lookX += event.movementX;
      state.lookY += event.movementY;
    } else if (dragging) {
      state.lookX += event.movementX;
      state.lookY += event.movementY;
    }
  });
  canvas.addEventListener('mousedown', (event) => {
    if (event.button === 0) {
      // Firing works locked or not: without a lock the same press starts a
      // look-drag, so aiming by dragging also fires, as in the play test.
      state.firing = true;
      if (!state.locked) dragging = true;
    }
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) {
      state.firing = false;
      dragging = false;
    }
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      try {
        const p = canvas.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        // Headless browsers refuse the lock; drag-look still works.
      }
    },
    exitLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
  };
}
