const assert = require("assert").strict;
const { SentenceChunker } = require("../../utils/sentence_chunker");

describe("SentenceChunker", () => {
  it("waits briefly for a nearby soft boundary in eager mode", () => {
    const chunker = new SentenceChunker({
      eagerCharThreshold: 14,
      eagerLookaheadChars: 8,
      eagerMinTtsChars: 1,
      minTtsChars: 1,
    });
    chunker.setEager(true);

    const first = chunker.push("嗯，好～希望接下来的日子都顺");
    assert.deepEqual(first, []);

    const second = chunker.push("心如意，");
    assert.deepEqual(second, ["嗯，好～希望接下来的日子都顺心如意，"]);

    chunker.setEager(false);
    const third = chunker.push("有开心的事就分享给我呀！");
    assert.deepEqual(third, ["有开心的事就分享给我呀！"]);
    const last = chunker.flush();
    assert.equal(last, "");
  });
});
