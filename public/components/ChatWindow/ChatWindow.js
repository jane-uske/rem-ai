import { createMessageBubble } from "../MessageBubble/MessageBubble.js";

export class ChatWindow {
  /** @param {HTMLElement} container */
  constructor(container) {
    container.innerHTML = `
      <section class="chat-window">
        <div class="chat-window__scroll">
          <div class="chat-window__typing" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
        </div>
      </section>
    `;
    const root = container.querySelector(".chat-window");
    this._scroll = root.querySelector(".chat-window__scroll");
    this._typing = root.querySelector(".chat-window__typing");
  }

  /** @param {string} text */
  addSystem(text) {
    this._appendBubble(createMessageBubble("sys", text));
  }

  /** @param {string} text */
  addUser(text) {
    this._appendBubble(createMessageBubble("user", text));
  }

  /** @param {string} text */
  addError(text) {
    this._appendBubble(createMessageBubble("error", text));
  }

  /** @returns {HTMLDivElement} */
  startAssistantBubble() {
    const el = createMessageBubble("rem", "");
    this.appendNode(el);
    return el;
  }

  showTyping() {
    this._typing.classList.add("is-visible");
    this._typing.setAttribute("aria-hidden", "false");
    this.scrollToBottom();
  }

  hideTyping() {
    this._typing.classList.remove("is-visible");
    this._typing.setAttribute("aria-hidden", "true");
  }

  scrollToBottom() {
    this._scroll.scrollTop = this._scroll.scrollHeight;
  }

  /** @param {HTMLDivElement} el */
  _appendBubble(el) {
    this._scroll.insertBefore(el, this._typing);
    this.scrollToBottom();
  }

  /** @param {HTMLDivElement} el */
  appendNode(el) {
    this._scroll.insertBefore(el, this._typing);
    this.scrollToBottom();
  }
}
