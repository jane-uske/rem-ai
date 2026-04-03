/**
 * @param {"user" | "rem" | "error" | "sys"} role
 * @param {string} text
 * @returns {HTMLDivElement}
 */
export function createMessageBubble(role, text) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = text;
  return el;
}
