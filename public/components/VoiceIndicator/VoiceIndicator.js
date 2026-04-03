export class VoiceIndicator {
  /** @param {HTMLElement} container */
  constructor(container) {
    container.innerHTML = `
      <div class="voice-indicator" role="status" aria-live="polite">
        <div class="voice-indicator__bars" aria-hidden="true">
          <span class="voice-indicator__bar"></span>
          <span class="voice-indicator__bar"></span>
          <span class="voice-indicator__bar"></span>
          <span class="voice-indicator__bar"></span>
        </div>
        <span class="voice-indicator__caption"></span>
      </div>
    `;
    this._root = container.querySelector(".voice-indicator");
    this._caption = container.querySelector(".voice-indicator__caption");
  }

  /** @param {boolean} playing */
  setPlaying(playing) {
    this._root.classList.toggle("voice-indicator--active", playing);
    this._caption.textContent = playing ? "播放中" : "";
  }
}
