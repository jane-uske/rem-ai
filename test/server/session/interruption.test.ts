const assert = require("assert").strict;
const { InterruptController } = require("../../../voice/interrupt_controller");
const { RemSessionContext } = require("../../../brains/rem_session_context");
const { routeMessage } = require("../../../brains/brain_router");
const { loadSessionHarness, waitFor } = require("../../helpers/session_harness");

describe("interruption handling", () => {
  it("tracks interrupt controller lifecycle", () => {
    const ic = new InterruptController();
    const interrupted = [];

    ic.on("interrupted", () => interrupted.push(ic.state));

    const signal = ic.begin();
    assert.equal(ic.state, "generating");
    assert.equal(ic.active, true);
    assert.equal(signal.aborted, false);

    ic.markSpeaking();
    assert.equal(ic.state, "speaking");

    const didInterrupt = ic.interrupt();
    assert.equal(didInterrupt, true);
    assert.equal(ic.state, "idle");
    assert.equal(ic.active, false);
    assert.equal(signal.aborted, true);
    assert.deepEqual(interrupted, ["idle"]);
  });

  it("marks topic continuation when the user clearly continues the previous topic", () => {
    const ctx = new RemSessionContext("test-conn");
    ctx.updateLiveState("neutral", "我想优化一下语音体验", "好，我们先看 turn-taking");
    ctx.updateLiveState("neutral", "继续说刚才那个语音体验", "可以");

    assert.equal(ctx.persona.liveState.isContinuingTopic, true);
    assert.equal(ctx.persona.liveState.wasInterrupted, false);
    assert.ok(ctx.persona.liveState.lastTopicSummary.length > 0);
  });

  it("keeps interruption flags within the public persona state", () => {
    const ctx = new RemSessionContext("test-conn");
    ctx.beginSlowBrain();
    ctx.cancelSlowBrain();
    assert.equal(ctx.persona.liveState.wasInterrupted, true);

    ctx.updateLiveState("happy", "随便聊聊", "好呀");
    assert.equal(ctx.persona.liveState.wasInterrupted, false);
    assert.equal(ctx.persona.liveState.currentMood, "happy");
    assert.equal(ctx.persona.liveState.emotionalState, "开心");
  });

  it("returns the last interrupted reply for a carry-forward query", async () => {
    const ctx = new RemSessionContext("test-conn");
    ctx.lastInterruptedReply = "我刚才说到语音真人感最重要的是接话时机。";

    const chunks = [];
    for await (const chunk of routeMessage(
      ctx,
      "刚才说到哪了",
      "neutral",
    )) {
      chunks.push(chunk);
    }

    assert.equal(chunks.join(""), "我刚才说到：我刚才说到语音真人感最重要的是接话时机。");
  });

  it("uses the in-flight assistant draft for carry-forward on immediate text interruption", async () => {
    const { ws, session, pipelineCalls, restore } = loadSessionHarness();
    try {
      session.brain.currentAssistantDraft = "我刚才想说先把打断承接做好。";
      session.interrupt.begin();

      ws.emitMessage(
        Buffer.from(
          JSON.stringify({
            type: "chat",
            content: "不是那个意思，我想说的是先把误触发压住",
          }),
        ),
      );

      await waitFor(() => pipelineCalls.length === 1);
      assert.equal(pipelineCalls[0].options?.interruptionType, "correction");
      assert.ok(pipelineCalls[0].options?.carryForwardHint?.includes("先把打断承接做好"));
      assert.equal(session.brain.lastInterruptedReply, "我刚才想说先把打断承接做好。");
    } finally {
      restore();
    }
  });
});
