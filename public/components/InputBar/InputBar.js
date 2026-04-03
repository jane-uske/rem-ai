export class InputBar {
  /**
   * @param {HTMLElement} container
   * @param {{ onSend: (text: string) => void; onMicToggle: () => void }} handlers
   */
  constructor(container, handlers) {
    this._onSend = handlers.onSend;
    this._onMicToggle = handlers.onMicToggle;

    container.innerHTML = `
      <div class="input-bar">
        <button type="button" class="input-bar__btn input-bar__btn--mic" title="语音输入" disabled>&#127908;</button>
        <input class="input-bar__field" type="text" placeholder="说点什么…" autocomplete="off" disabled />
        <button type="button" class="input-bar__btn input-bar__btn--send" disabled>&#8593;</button>
      </div>
    `;

    this._mic = container.querySelector(".input-bar__btn--mic");
    this._input = container.querySelector(".input-bar__field");
    this._send = container.querySelector(".input-bar__btn--send");

    this._send.addEventListener("click", () => this._emitSend());
    this._input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) this._emitSend();
    });
    this._mic.addEventListener("click", () => this._onMicToggle());
  }

  _emitSend() {
    const text = this._input.value.trim();
    if (!text) return;
    this._onSend(text);
  }

  /** @param {boolean} v */
  setWaiting(v) {
    this._send.disabled = v;
    this._input.disabled = v;
  }

  /** Call when recording stops; input state is driven by setWaiting / setConnected. */
  setRecording(recording) {
    this._mic.classList.toggle("is-recording", recording);
    this._mic.innerHTML = recording ? "&#9632;" : "&#127908;";
    if (recording) {
      this._input.disabled = true;
      this._send.disabled = true;
    }
  }

  /**
   * @param {boolean} connected
   * @param {{ enableMic: boolean }} [opts]
   */
  setConnected(connected, opts = {}) {
    const { enableMic = false } = opts;
    if (!connected) {
      this._input.disabled = true;
      this._send.disabled = true;
      this._mic.disabled = true;
      return;
    }
    this._input.disabled = false;
    this._send.disabled = false;
    this._mic.disabled = !enableMic;
  }

  focus() {
    this._input.focus();
  }

  /** @param {string} placeholder */
  setPlaceholder(placeholder) {
    this._input.placeholder = placeholder;
  }

  clear() {
    this._input.value = "";
  }
}
