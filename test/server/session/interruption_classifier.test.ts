const assert = require("assert").strict;
const {
  buildCarryForwardHint,
  classifyInterruption,
} = require("../../../server/session/interruption");

describe("interruption classifier", () => {
  it("detects continuation from explicit continuation phrasing", () => {
    const kind = classifyInterruption(
      "然后刚才那个 turn-taking 你继续说",
      "我刚才想说语音里最重要的是接话时机。",
    );
    assert.equal(kind, "continuation");
  });

  it("detects correction phrasing", () => {
    const kind = classifyInterruption(
      "不是，我的意思是先把打断承接做好",
      "我刚才想先讲 TTS 音色。",
    );
    assert.equal(kind, "correction");
  });

  it("detects more conversational correction phrasings", () => {
    const kind = classifyInterruption(
      "不是那个意思，我想说的是先把误触发压住",
      "我刚才想继续讲情绪语气。",
    );
    assert.equal(kind, "correction");
  });

  it("detects topic switch phrasing", () => {
    const kind = classifyInterruption(
      "算了，换个话题，我们先看前端状态",
      "我刚才想继续讲语音回合。",
    );
    assert.equal(kind, "topic_switch");
  });

  it("detects emotional interruption phrasing", () => {
    const kind = classifyInterruption(
      "等等，你先别说这个",
      "我刚才想先解释一下。",
    );
    assert.equal(kind, "emotional_interrupt");
  });

  it("detects continuation when the user explicitly returns to the previous point", () => {
    const kind = classifyInterruption(
      "回到刚才那个，你继续说语音节奏",
      "我刚才说到别太依赖静音阈值。",
    );
    assert.equal(kind, "continuation");
  });

  it("detects continuation from a shorter conversational supplement opener", () => {
    const kind = classifyInterruption(
      "补一句，刚才那个承接逻辑还得保留",
      "我刚才说到 interruption carry-forward 要自然一点。",
    );
    assert.equal(kind, "continuation");
  });

  it("detects topic switch when the user explicitly puts the previous topic aside", () => {
    const kind = classifyInterruption(
      "这个先放一边，我们先看 3D 表现",
      "我刚才还在说 duplex。",
    );
    assert.equal(kind, "topic_switch");
  });

  it("builds a carry-forward hint that references the interrupted reply", () => {
    const hint = buildCarryForwardHint(
      "continuation",
      "我刚才说到最重要的是减少硬重启感。",
    );
    assert.ok(hint.includes("承接"));
    assert.ok(hint.includes("减少硬重启感"));
    assert.ok(hint.includes("刚才那个我接着说"));
  });

  it("asks emotional interruptions to open with a short acknowledgement", () => {
    const hint = buildCarryForwardHint(
      "emotional_interrupt",
      "我刚才想解释一下。",
    );
    assert.ok(hint.includes("很短"));
    assert.ok(hint.includes("接住情绪"));
    assert.ok(hint.includes("好，我先停一下"));
  });
});
