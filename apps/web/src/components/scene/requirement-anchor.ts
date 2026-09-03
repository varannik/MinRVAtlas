/**
 * Shared between the 3D board (writes the selected chip's screen point) and
 * the DOM connector (reads it). Kept off React so it can update every frame
 * without re-rendering the dashboard.
 */
export const requirementAnchor = {
  screenX: 0,
  screenY: 0,
  valid: false,
};

export const panelAnchor = {
  screenX: 0,
  screenY: 0,
  visible: false,
};

/** DOM slot the 3D requirement board is fitted into. */
export const boardSlot = {
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  visible: false,
};
