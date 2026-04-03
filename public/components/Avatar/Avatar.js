const DEFAULT_MAP = {
  neutral: "/avatar/assets/neutral.svg",
  happy: "/avatar/assets/happy.svg",
  curious: "/avatar/assets/curious.svg",
  shy: "/avatar/assets/shy.svg",
  sad: "/avatar/assets/sad.svg",
};

export class Avatar {
  /**
   * @param {HTMLElement} container
   * @param {{ assetMap?: Record<string, string> }} [options]
   */
  constructor(container, options = {}) {
    this._map = { ...DEFAULT_MAP, ...options.assetMap };
    container.innerHTML = `
      <div class="avatar">
        <img class="avatar__img" src="${this._map.neutral}" alt="Rem Avatar" />
        <div class="avatar__meta">
          <div class="avatar__label">当前情绪</div>
          <div class="avatar__emotion">neutral</div>
        </div>
      </div>
    `;
    this._img = container.querySelector(".avatar__img");
    this._emotionEl = container.querySelector(".avatar__emotion");
  }

  /** @param {string | null | undefined} emotion */
  setEmotion(emotion) {
    const raw = String(emotion ?? "").trim();
    const key = this._map[raw] ? raw : "neutral";
    this._img.src = this._map[key];
    this._emotionEl.textContent = key;
  }
}
