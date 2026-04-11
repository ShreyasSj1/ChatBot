const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatWindow = document.getElementById("chat-window");
const sendBtn = document.getElementById("send-btn");
const micBtn = document.getElementById("mic-btn");
const chips = document.querySelectorAll(".chip");
const smartSuggestionsEl = document.getElementById("smart-suggestions");
const resumeCard = document.getElementById("resume-card");
const resolveYesBtn = document.getElementById("resolve-yes-btn");
const resolveNoBtn = document.getElementById("resolve-no-btn");
const voiceStatePanel = document.getElementById("voice-state-panel");
const waveBars = document.getElementById("wave-bars");
const processingIndicator = document.getElementById("processing-indicator");
const voiceStateText = document.getElementById("voice-state-text");
const voiceStyleSelect = document.getElementById("voice-style");
const voiceRateInput = document.getElementById("voice-rate");
const voicePitchInput = document.getElementById("voice-pitch");
const voiceVolumeInput = document.getElementById("voice-volume");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const BOT_RESPONSE_DELAY_MS = 1500;
const TTS_LEAD_IN_MS = 140;

let recognition = null;
let isListening = false;
let isSpeaking = false;
let selectedVoice = null;
let speechSequence = 0;
let speechFadeTimer = null;
let voiceUiState = "idle";
let cachedActiveHistory = [];

const INITIAL_BOT_MESSAGE = "Hi! I can help with order status and FAQ-related questions.";

const voiceSettings = {
  style: "sweet",
  rate: 0.92,
  pitch: 1.05,
  volume: 1,
};

const voiceStylePresets = {
  sweet: { rate: 0.92, pitch: 1.08, volume: 1 },
  natural: { rate: 0.95, pitch: 1.02, volume: 1 },
  clear: { rate: 0.9, pitch: 1.0, volume: 1 },
};

const preferredVoiceNames = [
  "Samantha",
  "Google UK English Female",
  "Google US English",
  "Microsoft Aria Online (Natural) - English (United States)",
  "Microsoft Jenny Online (Natural) - English (United States)",
  "Microsoft Zira Desktop - English (United States)",
  "Ava",
  "Allison",
];

function getTimeLabel() {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTimestampLabel(rawTimestamp) {
  if (!rawTimestamp) {
    return getTimeLabel();
  }

  const normalized = String(rawTimestamp).replace(" ", "T");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return getTimeLabel();
  }
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function setVoiceUiState(state) {
  voiceUiState = state;

  if (!voiceStatePanel) {
    return;
  }

  const isIdle = state === "idle";
  voiceStatePanel.hidden = isIdle;
  voiceStatePanel.classList.toggle("show", !isIdle);

  if (waveBars) {
    waveBars.hidden = state !== "listening";
  }
  if (processingIndicator) {
    processingIndicator.hidden = state !== "processing";
  }
  if (voiceStateText) {
    voiceStateText.textContent = state === "processing" ? "Processing..." : "Listening...";
  }

  if (micBtn) {
    micBtn.classList.toggle("mic-active", state === "listening");
    micBtn.classList.toggle("mic-processing", state === "processing");
    micBtn.classList.toggle("listening", state === "listening");
    micBtn.setAttribute("aria-pressed", state === "listening" ? "true" : "false");
  }
}

function appendMessage(text, type, timeLabel = getTimeLabel()) {
  const row = document.createElement("div");
  row.className = `message-row ${type === "user" ? "user-row" : "bot-row"}`;

  const msg = document.createElement("div");
  msg.className = `message ${type === "user" ? "user-message" : "bot-message"}`;
  msg.textContent = text;

  const meta = document.createElement("span");
  meta.className = "message-time";
  meta.textContent = timeLabel;

  row.appendChild(msg);
  row.appendChild(meta);
  chatWindow.appendChild(row);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return row;
}

function appendTyping() {
  const row = document.createElement("div");
  row.className = "message-row bot-row";

  const bubble = document.createElement("div");
  bubble.className = "message bot-message typing-message";
  bubble.innerHTML = `
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
  `;

  row.appendChild(bubble);
  chatWindow.appendChild(row);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return row;
}

function normalizeForSpeech(text) {
  return text
    .replace(/[`*_#]/g, " ")
    .replace(/\n+/g, ". ")
    .replace(/\s*[:;]\s*/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSpeechChunks(text, maxChunkLength = 170) {
  const sentenceLike = text.match(/[^.!?]+[.!?]?/g) || [text];
  const chunks = [];
  let current = "";

  sentenceLike.forEach((part) => {
    const sentence = part.trim();
    if (!sentence) {
      return;
    }

    if ((`${current} ${sentence}`).trim().length <= maxChunkLength) {
      current = `${current} ${sentence}`.trim();
      return;
    }

    if (current) {
      chunks.push(current);
    }

    if (sentence.length <= maxChunkLength) {
      current = sentence;
      return;
    }

    for (let i = 0; i < sentence.length; i += maxChunkLength) {
      chunks.push(sentence.slice(i, i + maxChunkLength));
    }
    current = "";
  });

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function scoreVoice(voice) {
  const name = (voice.name || "").toLowerCase();
  const lang = (voice.lang || "").toLowerCase();
  let score = 0;

  if (lang.startsWith("en")) {
    score += 40;
  }
  if (lang === "en-us") {
    score += 15;
  }
  if (voice.localService) {
    score += 45;
  } else {
    score -= 35;
  }
  if (/online/.test(name)) {
    score -= 30;
  }

  if (/(samantha|zira|jenny|aria|allison|ava|female|woman|karen|moira)/.test(name)) {
    score += 35;
  }
  if (/(david|mark|guy|male|man)/.test(name)) {
    score -= 20;
  }

  const preferredIndex = preferredVoiceNames.findIndex(
    (candidate) => candidate.toLowerCase() === name
  );
  if (preferredIndex !== -1) {
    score += 120 - preferredIndex;
  }

  return score;
}

function updatePreferredVoice() {
  if (!("speechSynthesis" in window)) {
    return;
  }

  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) {
    return;
  }

  selectedVoice = voices
    .slice()
    .sort((a, b) => scoreVoice(b) - scoreVoice(a))[0];
}

function setSpeakingState(active) {
  isSpeaking = active;
  if (micBtn) {
    micBtn.classList.toggle("speaking", active);
  }
}

function queueSpeechChunks(chunks, sequenceId) {
  if (sequenceId !== speechSequence) {
    return;
  }

  let pendingUtterances = chunks.length;
  setSpeakingState(pendingUtterances > 0);

  chunks.forEach((chunk) => {
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.voice = selectedVoice || null;
    utterance.lang = selectedVoice?.lang || "en-US";
    utterance.rate = voiceSettings.rate;
    utterance.pitch = voiceSettings.pitch;
    utterance.volume = voiceSettings.volume;
    const finalizeUtterance = () => {
      pendingUtterances -= 1;
      if (pendingUtterances <= 0) {
        setSpeakingState(false);
      }
    };
    utterance.onend = finalizeUtterance;
    utterance.onerror = finalizeUtterance;
    window.speechSynthesis.speak(utterance);
  });
}

function interruptSpeechWithFade(options = { soft: true }) {
  if (!("speechSynthesis" in window)) {
    return Promise.resolve();
  }

  speechSequence += 1;
  if (speechFadeTimer) {
    window.clearTimeout(speechFadeTimer);
    speechFadeTimer = null;
  }

  const hasSpeech = window.speechSynthesis.speaking || window.speechSynthesis.pending || isSpeaking;
  if (!hasSpeech) {
    window.speechSynthesis.cancel();
    setSpeakingState(false);
    return Promise.resolve();
  }

  if (!options.soft) {
    window.speechSynthesis.cancel();
    setSpeakingState(false);
    return Promise.resolve();
  }

  try {
    window.speechSynthesis.pause();
  } catch (error) {
    window.speechSynthesis.cancel();
    setSpeakingState(false);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    speechFadeTimer = window.setTimeout(() => {
      window.speechSynthesis.cancel();
      setSpeakingState(false);
      speechFadeTimer = null;
      resolve();
    }, 140);
  });
}

function warmupSpeechEngine() {
  if (!("speechSynthesis" in window)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      resolve();
    };

    const timeoutId = window.setTimeout(finish, 260);
    const warmup = new SpeechSynthesisUtterance(".");
    warmup.voice = selectedVoice || null;
    warmup.lang = selectedVoice?.lang || "en-US";
    warmup.rate = 1;
    warmup.pitch = 1;
    warmup.volume = 0;
    warmup.onend = () => {
      window.clearTimeout(timeoutId);
      finish();
    };
    warmup.onerror = () => {
      window.clearTimeout(timeoutId);
      finish();
    };

    window.speechSynthesis.speak(warmup);
  });
}

function syncVoiceControlsFromSettings() {
  if (voiceStyleSelect) {
    voiceStyleSelect.value = voiceSettings.style;
  }
  if (voiceRateInput) {
    voiceRateInput.value = String(voiceSettings.rate);
  }
  if (voicePitchInput) {
    voicePitchInput.value = String(voiceSettings.pitch);
  }
  if (voiceVolumeInput) {
    voiceVolumeInput.value = String(voiceSettings.volume);
  }
}

function applyVoiceStyle(style, shouldSyncInputs = true) {
  const preset = voiceStylePresets[style];
  if (!preset) {
    return;
  }

  voiceSettings.style = style;
  voiceSettings.rate = preset.rate;
  voiceSettings.pitch = preset.pitch;
  voiceSettings.volume = preset.volume;

  if (shouldSyncInputs) {
    syncVoiceControlsFromSettings();
  }
}

function wireVoiceControls() {
  if (voiceStyleSelect) {
    voiceStyleSelect.addEventListener("change", (event) => {
      applyVoiceStyle(event.target.value);
    });
  }

  if (voiceRateInput) {
    voiceRateInput.addEventListener("input", (event) => {
      voiceSettings.rate = Number(event.target.value);
    });
  }

  if (voicePitchInput) {
    voicePitchInput.addEventListener("input", (event) => {
      voiceSettings.pitch = Number(event.target.value);
    });
  }

  if (voiceVolumeInput) {
    voiceVolumeInput.addEventListener("input", (event) => {
      voiceSettings.volume = Number(event.target.value);
    });
  }
}

function getContextualSuggestions(lastUserMessage, botReply) {
  const text = `${lastUserMessage || ""} ${botReply || ""}`.toLowerCase();

  if (text.includes("order #") || text.includes("currently")) {
    return ["Track my order", "Delivery time", "Cancel my order"];
  }
  if (text.includes("cancel")) {
    return ["Cancellation policy", "Track my order", "Contact support"];
  }
  if (text.includes("refund")) {
    return ["Refund help", "Missing or wrong item", "Contact support"];
  }
  if (text.includes("delivery")) {
    return ["Delivery charges", "Delivery time", "Track my order"];
  }
  if (text.includes("support") || text.includes("help")) {
    return ["Contact support", "Refund help", "Track my order"];
  }

  return ["Track my order", "Cancel my order", "Delivery time"];
}

function renderSmartSuggestions(suggestions) {
  if (!smartSuggestionsEl) {
    return;
  }

  const uniqueSuggestions = [...new Set(suggestions)].slice(0, 3);
  smartSuggestionsEl.innerHTML = "";

  uniqueSuggestions.forEach((label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "smart-chip";
    button.textContent = label;
    button.addEventListener("click", () => {
      chatInput.value = label.toLowerCase();
      handleSend();
    });
    smartSuggestionsEl.appendChild(button);
  });
}

function resetChatWindow() {
  chatWindow.innerHTML = "";
  appendMessage(INITIAL_BOT_MESSAGE, "bot", "Now");
  renderSmartSuggestions(["Track my order", "Cancel my order", "Delivery time"]);
}

function restoreChatHistory(messages) {
  chatWindow.innerHTML = "";

  messages.forEach((entry) => {
    const senderType = entry.sender === "user" ? "user" : "bot";
    appendMessage(entry.message, senderType, formatTimestampLabel(entry.timestamp));
  });

  const lastUser = [...messages].reverse().find((m) => m.sender === "user");
  const lastBot = [...messages].reverse().find((m) => m.sender === "bot");
  renderSmartSuggestions(
    getContextualSuggestions(lastUser?.message || "", lastBot?.message || "")
  );
}

async function fetchActiveHistory() {
  const response = await fetch("/get-chat-history");
  if (!response.ok) {
    return { has_active_chat: false, messages: [] };
  }
  return response.json();
}

function showResumeCard(visible) {
  if (!resumeCard) {
    return;
  }
  resumeCard.hidden = !visible;
}

async function resolvePreviousChat() {
  await fetch("/resolve-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

function stopListeningIfNeeded() {
  if (!recognition || !isListening) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      isListening = false;
      resolve();
    };

    const fallbackTimer = window.setTimeout(finish, 350);
    recognition.onend = () => {
      window.clearTimeout(fallbackTimer);
      finish();
    };

    try {
      recognition.abort();
    } catch (error) {
      try {
        recognition.stop();
      } catch (innerError) {
        window.clearTimeout(fallbackTimer);
        finish();
      }
    }
  });
}

async function speakText(text, options = {}) {
  const onStart = typeof options.onStart === "function" ? options.onStart : () => {};

  if (!("speechSynthesis" in window) || !text) {
    onStart();
    return;
  }

  if (isSpeaking) {
    await interruptSpeechWithFade({ soft: false });
  }

  await stopListeningIfNeeded();

  updatePreferredVoice();
  const cleanText = normalizeForSpeech(text);
  const chunks = cleanText.length > 900 ? splitSpeechChunks(cleanText, 420) : [cleanText];
  if (!chunks.length) {
    onStart();
    return;
  }

  speechSequence += 1;
  window.speechSynthesis.cancel();
  const currentSequence = speechSequence;
  await warmupSpeechEngine();
  if (currentSequence !== speechSequence) {
    return;
  }

  window.setTimeout(() => {
    onStart();
    queueSpeechChunks(chunks, currentSequence);
  }, TTS_LEAD_IN_MS);
}

async function sendChatMessage(message) {
  const response = await fetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    return "Sorry, this information is not available currently.";
  }

  const data = await response.json();
  return data.reply || "Sorry, this information is not available currently.";
}

async function handleSend(event, options = {}) {
  if (event) {
    event.preventDefault();
  }

  const message = chatInput.value.trim();
  if (!message) {
    return;
  }

  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending...";
  }

  appendMessage(message, "user");
  chatInput.value = "";
  chatInput.focus();

  if (options.fromVoice) {
    setVoiceUiState("processing");
  }

  const typingEl = appendTyping();

  try {
    const reply = await sendChatMessage(message);
    window.setTimeout(() => {
      speakText(reply, {
        onStart: () => {
          typingEl.remove?.();
          appendMessage(reply, "bot");
          renderSmartSuggestions(getContextualSuggestions(message, reply));
          if (voiceUiState !== "idle") {
            setVoiceUiState("idle");
          }
        },
      });
    }, BOT_RESPONSE_DELAY_MS);
  } catch (error) {
    window.setTimeout(() => {
      const fallback = "Sorry, this information is not available currently.";
      speakText(fallback, {
        onStart: () => {
          typingEl.remove?.();
          appendMessage(fallback, "bot");
          renderSmartSuggestions(getContextualSuggestions(message, fallback));
          if (voiceUiState !== "idle") {
            setVoiceUiState("idle");
          }
        },
      });
    }, BOT_RESPONSE_DELAY_MS);
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
    }
  }
}

function startListening() {
  if (!SpeechRecognition) {
    alert("Speech recognition is not supported in this browser. Please use Chrome.");
    return;
  }

  if (!window.isSecureContext && window.location.hostname !== "localhost") {
    alert("Voice input needs a secure context (HTTPS or localhost).");
    return;
  }

  if (isSpeaking) {
    interruptSpeechWithFade({ soft: true }).then(() => {
      startListening();
    });
    return;
  }

  if (isListening) {
    recognition?.stop();
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = (navigator.language || "en-US");
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;
  let finalTranscript = "";

  recognition.onstart = () => {
    isListening = true;
    setVoiceUiState("listening");
  };

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      if (event.results[i].isFinal) {
        finalTranscript += `${event.results[i][0].transcript} `;
      }
    }
    const transcript = finalTranscript.trim();
    if (!transcript) {
      return;
    }

    setVoiceUiState("processing");
    chatInput.value = transcript;
    finalTranscript = "";
    recognition.stop();
    handleSend(null, { fromVoice: true });
  };

  recognition.onspeechend = () => {
    if (voiceUiState === "listening") {
      setVoiceUiState("processing");
    }
    try {
      recognition.stop();
    } catch (error) {
      // no-op: stop may throw if already stopped
    }
  };

  recognition.onnomatch = () => {
    appendMessage("Could not understand, please try again", "bot");
    setVoiceUiState("idle");
  };

  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      alert("Microphone access is required for voice input");
    } else if (event.error === "no-speech" || event.error === "audio-capture") {
      appendMessage("Could not understand, please try again", "bot");
    }

    if (voiceUiState !== "processing") {
      setVoiceUiState("idle");
    }
  };

  recognition.onend = () => {
    isListening = false;
    if (voiceUiState === "listening") {
      setVoiceUiState("idle");
    }
  };

  try {
    recognition.start();
  } catch (error) {
    if (error?.name === "InvalidStateError") {
      window.setTimeout(() => {
        try {
          recognition.start();
        } catch (innerError) {
          appendMessage("Could not start microphone. Please try again.", "bot");
          setVoiceUiState("idle");
        }
      }, 120);
      return;
    }
    appendMessage("Could not start microphone. Please try again.", "bot");
    setVoiceUiState("idle");
  }
}

async function initContinuationPrompt() {
  try {
    const historyPayload = await fetchActiveHistory();
    const hasActive = Boolean(historyPayload?.has_active_chat) && historyPayload.messages?.length > 0;
    cachedActiveHistory = hasActive ? historyPayload.messages : [];
    showResumeCard(hasActive);

    if (!hasActive) {
      renderSmartSuggestions(["Track my order", "Cancel my order", "Delivery time"]);
    }
  } catch (error) {
    showResumeCard(false);
    renderSmartSuggestions(["Track my order", "Cancel my order", "Delivery time"]);
  }
}

chatForm.addEventListener("submit", handleSend);

chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    chatInput.value = chip.dataset.msg || "";
    handleSend();
  });
});

if (micBtn) {
  micBtn.addEventListener("click", startListening);
}

if (resolveYesBtn) {
  resolveYesBtn.addEventListener("click", async () => {
    await resolvePreviousChat();
    cachedActiveHistory = [];
    showResumeCard(false);
    resetChatWindow();
  });
}

if (resolveNoBtn) {
  resolveNoBtn.addEventListener("click", async () => {
    if (!cachedActiveHistory.length) {
      const historyPayload = await fetchActiveHistory();
      cachedActiveHistory = historyPayload.messages || [];
    }
    showResumeCard(false);
    if (cachedActiveHistory.length) {
      restoreChatHistory(cachedActiveHistory);
    }
  });
}

applyVoiceStyle("sweet");
wireVoiceControls();
setVoiceUiState("idle");
initContinuationPrompt();

if ("speechSynthesis" in window) {
  updatePreferredVoice();
  if (typeof window.speechSynthesis.addEventListener === "function") {
    window.speechSynthesis.addEventListener("voiceschanged", updatePreferredVoice);
  } else {
    window.speechSynthesis.onvoiceschanged = updatePreferredVoice;
  }
}
