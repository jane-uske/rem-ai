const assert = require("assert").strict;
const { buildPrompt } = require("../../brain/prompt_builder");
const { createDefaultPersona } = require("../../persona");
const { RemSessionContext } = require("../../brains/rem_session_context");

describe("prompt builder emotion speech style", () => {
  it("includes richer happy expression and speech rhythm hints", () => {
    const messages = buildPrompt({
      memory: [],
      emotion: "happy",
      history: [],
      userMessage: "你今天开心吗",
    });

    const system = messages[0].content;
    assert.ok(system.includes("情绪表达风格"));
    assert.ok(system.includes("说话节奏提示"));
    assert.ok(system.includes("雀跃感"));
    assert.ok(system.includes("起句更快一点"));
  });

  it("includes soft, slower guidance for sad replies", () => {
    const messages = buildPrompt({
      memory: [],
      emotion: "sad",
      history: [],
      userMessage: "你怎么了",
    });

    const system = messages[0].content;
    assert.ok(system.includes("低落"));
    assert.ok(system.includes("更慢"));
    assert.ok(system.includes("句尾更收"));
  });

  it("keeps emotion speech guidance even when persona mode is enabled", () => {
    const persona = createDefaultPersona();
    persona.liveState.currentMood = "curious";
    persona.liveState.emotionalState = "好奇";

    const messages = buildPrompt({
      memory: [],
      emotion: "curious",
      history: [],
      userMessage: "你为什么这么问",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("情绪表达风格"));
    assert.ok(system.includes("说话节奏提示"));
    assert.ok(system.includes("轻追问"));
    assert.ok(system.includes("句尾可以稍微上挑"));
  });

  it("includes continuity guidance when persona says the user is continuing the topic", () => {
    const persona = createDefaultPersona();
    persona.liveState.isContinuingTopic = true;
    persona.liveState.lastTopicSummary = "语音节奏、打断承接";

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "继续刚才那个",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("延续刚才的话题"));
    assert.ok(system.includes("不要像全新话题重开"));
  });

  it("includes interruption recovery guidance when persona was interrupted", () => {
    const persona = createDefaultPersona();
    persona.liveState.wasInterrupted = true;

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "你继续",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("你刚刚被打断过"));
    assert.ok(system.includes("先用一句很短的话接住上下文"));
  });

  it("does not add interruption guidance after slow brain cancellation alone", () => {
    const ctx = new RemSessionContext("test-conn");
    ctx.beginSlowBrain();
    ctx.cancelSlowBrain();

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "继续说",
      persona: ctx.persona,
    });

    const system = messages[0].content;
    assert.ok(!system.includes("你刚刚被打断过"));
    assert.ok(!system.includes("先用一句很短的话接住上下文"));
  });
});
