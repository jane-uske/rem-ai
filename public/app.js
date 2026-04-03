import { Avatar } from "/components/Avatar/Avatar.js";
import { VoiceIndicator } from "/components/VoiceIndicator/VoiceIndicator.js";
import { ChatWindow } from "/components/ChatWindow/ChatWindow.js";
import { InputBar } from "/components/InputBar/InputBar.js";

const WS_URL = `ws://${location.host}`;

const el = (id) => {
  const n = document.getElementById(id);
  if (!n) throw new Error(`Missing #${id}`);
  return n;
};

const chat = new ChatWindow(el("mount-chat"));
const avatar = new Avatar(el("mount-avatar"));
const voice = new VoiceIndicator(el("mount-voice"));

const connDot = el("conn-dot");
const connTxt = el("conn-txt");

let ws;
let waiting = false;
let currentBubble = null;

const audioQueue = [];
let audioPlaying = false;

function syncVoiceIndicator() {
  voice.setPlaying(audioPlaying || audioQueue.length > 0);
}

function detectMime(buf) {
  if (
    buf.length > 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x41 &&
    buf[10] === 0x56 &&
    buf[11] === 0x45
  )
    return "audio/wav";
  if (
    (buf.length > 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) ||
    (buf.length > 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
  )
    return "audio/mpeg";
  return "audio/wav";
}

function queueAudio(base64) {
  try {
    const bin = atob(base64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const blob = new Blob([buf], { type: detectMime(buf) });
    audioQueue.push(URL.createObjectURL(blob));
    syncVoiceIndicator();
    drainAudio();
  } catch {
    /* ignore */
  }
}

function drainAudio() {
  if (audioPlaying || !audioQueue.length) return;
  audioPlaying = true;
  syncVoiceIndicator();
  const url = audioQueue.shift();
  const a = new Audio(url);
  a.onended = () => {
    URL.revokeObjectURL(url);
    audioPlaying = false;
    syncVoiceIndicator();
    drainAudio();
  };
  a.onerror = () => {
    URL.revokeObjectURL(url);
    audioPlaying = false;
    syncVoiceIndicator();
    drainAudio();
  };
  a.play().catch(() => {
    audioPlaying = false;
    syncVoiceIndicator();
    drainAudio();
  });
}

let mediaRecorder = null;
let recording = false;
const hasMic = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

const inputBar = new InputBar(el("mount-input"), {
  onSend: (text) => {
    if (!text || waiting || !ws || ws.readyState !== WebSocket.OPEN) return;
    chat.addUser(text);
    ws.send(JSON.stringify({ type: "chat", content: text }));
    inputBar.clear();
    waiting = true;
    inputBar.setWaiting(true);
    chat.showTyping();
  },
  onMicToggle: () => {
    if (recording) stopRecording();
    else void toggleMic();
  },
});

function setConnectedUI(connected) {
  connDot.classList.toggle("on", connected);
  connTxt.textContent = connected ? "在线" : "已断开";
  inputBar.setConnected(connected, { enableMic: hasMic });
  if (connected) inputBar.focus();
}

async function toggleMic() {
  if (recording) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    mediaRecorder = new MediaRecorder(stream, { mimeType });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = reader.result.split(",")[1];
        ws.send(JSON.stringify({ type: "audio_chunk", audio: b64 }));
      };
      reader.readAsDataURL(e.data);
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      ws.send(JSON.stringify({ type: "audio_end" }));
      chat.showTyping();
      chat.scrollToBottom();
    };

    mediaRecorder.start(500);
    recording = true;
    inputBar.setRecording(true);
    inputBar.setPlaceholder("录音中…");
  } catch {
    chat.addError("无法访问麦克风");
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  recording = false;
  inputBar.setRecording(false);
  inputBar.setPlaceholder("识别中…");
  inputBar.setWaiting(true);
  waiting = true;
}

function connect() {
  connTxt.textContent = "连接中…";
  connDot.classList.remove("on");
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setConnectedUI(true);
    chat.addSystem("已连接，和 Rem 聊聊吧");
  };

  ws.onmessage = (e) => {
    let data;
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }

    switch (data.type) {
      case "emotion":
        if (data.emotion != null) {
          try {
            avatar.setEmotion(data.emotion);
          } catch {
            /* ignore */
          }
        }
        break;

      case "chat_chunk":
        chat.hideTyping();
        if (!currentBubble) currentBubble = chat.startAssistantBubble();
        currentBubble.textContent += data.content;
        chat.scrollToBottom();
        break;

      case "chat_end":
        currentBubble = null;
        waiting = false;
        inputBar.setWaiting(false);
        inputBar.setPlaceholder("说点什么…");
        if (data.emotion != null) {
          try {
            avatar.setEmotion(data.emotion);
          } catch {
            /* ignore */
          }
        }
        inputBar.focus();
        break;

      case "voice":
        if (data.audio) queueAudio(data.audio);
        break;

      case "stt_partial":
        break;

      case "stt_final":
        chat.hideTyping();
        chat.addUser(data.content);
        inputBar.setPlaceholder("说点什么…");
        waiting = true;
        inputBar.setWaiting(true);
        chat.showTyping();
        chat.scrollToBottom();
        break;

      case "error":
        chat.hideTyping();
        currentBubble = null;
        waiting = false;
        inputBar.setWaiting(false);
        inputBar.setPlaceholder("说点什么…");
        chat.addError(data.content);
        break;

      default:
        break;
    }
  };

  ws.onclose = () => {
    if (recording) {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
      recording = false;
      inputBar.setRecording(false);
    }
    setConnectedUI(false);
    waiting = false;
    currentBubble = null;
    chat.hideTyping();
    chat.addSystem("连接已断开，3 秒后重连…");
    setTimeout(connect, 3000);
  };

  ws.onerror = () => {};
}

connect();
avatar.setEmotion("neutral");
