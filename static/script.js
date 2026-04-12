const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatWindow = document.getElementById("chat-window");
const sendBtn = document.getElementById("send-btn");
const micBtn = document.getElementById("mic-btn");
const chips = document.querySelectorAll(".chip");
const voiceOverlay = document.getElementById("voice-overlay");
const voiceOverlayTitle = document.getElementById("voice-overlay-title");
const voiceOverlaySubtitle = document.getElementById("voice-overlay-subtitle");
const closeVoiceBtn = document.getElementById("close-voice-btn");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const BOT_RESPONSE_DELAY_MS = 1500;
const TTS_LEAD_IN_MS = 140;
const VOICE_SETTINGS_STORAGE_KEY = "zappit_voice_settings_v1";

let recognition = null;
let isListening = false;
let isSpeaking = false;
let selectedVoice = null;
let speechSequence = 0;
let speechFadeTimer = null;
let voiceUiState = "idle";
let cachedActiveHistory = [];
let chatLockedByResolution = false;
let resolvePromptRendered = false;
let activeLanguage = localStorage.getItem("zappit_lang") || "en";
let isVoiceMode = false;

const langBtns = document.querySelectorAll(".lang-btn");

const UI_STRINGS = {
  en: {
    welcome: "Welcome",
    user_id: "User ID",
    orders: "Orders",
    logout: "Logout",
    your_orders: "Your Orders",
    order_prefix: "Order",
    status_preparing: "Preparing",
    status_out: "Out for delivery",
    status_delivered: "Delivered",
    status_cancelled: "Cancelled",
    zappit_title: "ZAPPIT",
    try_hint: "Try",
    or: "or",
    hint_1: "order status",
    hint_2: "order status 1021",
    quick_actions: "Quick actions",
    chip_where: "Where is my order?",
    chip_status: "Check order status",
    chip_cancel: "Cancel order",
    chip_charges: "Delivery charges",
    chip_refund: "Refund help",
    chip_missing: "Missing or wrong item",
    chip_support: "Contact support",
    chip_time: "Delivery time",
    initial_bot_msg: "Hi! I can help with order status and FAQ-related questions.",
    now: "Now",
    input_placeholder: "Type your message...",
    send: "Send",
    listening: "Listening...",
    processing: "Thinking...",
    speaking: "Speaking...",
    listening_sub: "Tell me what's on your mind",
    processing_sub: "Just a moment...",
    speaking_sub: "Zappit is responding",
    mic_error: "Microphone access is required for voice input",
    understanding_error: "Could not understand, please try again"
  },
  hi: {
    welcome: "स्वागत है",
    user_id: "यूज़र आईडी",
    orders: "ऑर्डर",
    logout: "लॉगआउट",
    your_orders: "आपके ऑर्डर",
    order_prefix: "ऑर्डर",
    status_preparing: "तैयार हो रहा है",
    status_out: "डिलिवरी के लिए निकल गया",
    status_delivered: "डिलिवर हो गया",
    status_cancelled: "रद्द कर दिया गया",
    zappit_title: "जप्पिट",
    try_hint: "कोशिश करें",
    or: "या",
    hint_1: "ऑर्डर स्टेटस",
    hint_2: "ऑर्डर स्टेटस 1021",
    quick_actions: "तुरंत कार्रवाई",
    chip_where: "मेरा ऑर्डर कहाँ है?",
    chip_status: "ऑर्डर स्टेटस चेक करें",
    chip_cancel: "ऑर्डर रद्द करें",
    chip_charges: "डिलिवरी शुल्क",
    chip_refund: "रिफंड सहायता",
    chip_missing: "आइटम गायब या गलत है",
    chip_support: "सपोर्ट से संपर्क करें",
    chip_time: "डिलिवरी का समय",
    initial_bot_msg: "नमस्ते! मैं आपके ऑर्डर स्टेटस और FAQ से जुड़े सवालों में आपकी मदद कर सकता हूँ।",
    now: "अभी",
    input_placeholder: "अपना संदेश लिखें...",
    send: "भेजें",
    listening: "सुन रहे हैं...",
    processing: "सोच रहे हैं...",
    speaking: "बोल रहे हैं...",
    listening_sub: "बताएं मैं आपकी क्या मदद कर सकता हूँ",
    processing_sub: "बस एक पल...",
    speaking_sub: "जप्पिट जवाब दे रहा है",
    mic_error: "वॉयस इनपुट के लिए माइक्रोफ़ोन एक्सेस आवश्यक है",
    understanding_error: "समझ नहीं आया, कृपया पुनः प्रयास करें"
  }
};

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
  const strings = UI_STRINGS[activeLanguage] || UI_STRINGS.en;

  if (micBtn) {
    micBtn.classList.toggle("mic-active", state === "listening");
    micBtn.classList.toggle("mic-processing", state === "processing");
    micBtn.classList.toggle("listening", state === "listening");
    micBtn.setAttribute("aria-pressed", state === "listening" ? "true" : "false");
  }

  // Handle Full-Screen Overlay
  if (voiceOverlay) {
    const isOverlayState = (state === "listening" || state === "processing" || state === "speaking") && isVoiceMode;
    if (isOverlayState) {
      voiceOverlay.hidden = false;
      // Small delay to trigger transition
      requestAnimationFrame(() => {
        voiceOverlay.classList.add("show");
      });
    } else if (state === "idle" && !isSpeaking) {
      voiceOverlay.classList.remove("show");
      // Wait for transition then hide
      setTimeout(() => {
        if (!voiceOverlay.classList.contains("show")) {
          voiceOverlay.hidden = true;
        }
      }, 400);
    }

    voiceOverlay.classList.remove("listening", "processing", "speaking");
    if (state !== "idle") {
      voiceOverlay.classList.add(state);
    }

    if (voiceOverlayTitle) {
      if (state === "listening") voiceOverlayTitle.textContent = strings.listening;
      else if (state === "processing") voiceOverlayTitle.textContent = strings.processing;
      else if (state === "speaking") voiceOverlayTitle.textContent = strings.speaking;
    }

    if (voiceOverlaySubtitle) {
      if (state === "listening") voiceOverlaySubtitle.textContent = strings.listening_sub;
      else if (state === "processing") voiceOverlaySubtitle.textContent = strings.processing_sub;
      else if (state === "speaking") voiceOverlaySubtitle.textContent = strings.speaking_sub;
    }
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

function setChatLocked(locked) {
  chatLockedByResolution = locked;
  if (chatInput) {
    chatInput.disabled = locked;
  }
  if (sendBtn) {
    sendBtn.disabled = locked;
  }
  if (micBtn) {
    micBtn.disabled = locked;
  }
  chips.forEach((chip) => {
    chip.disabled = locked;
  });
}

function appendResolvePromptMessage() {
  if (resolvePromptRendered) {
    return;
  }

  const row = document.createElement("div");
  row.className = "message-row bot-row resolve-row";

  const bubble = document.createElement("div");
  bubble.className = "message bot-message resolve-chat-message";
  bubble.innerHTML = `
    <p>Is your previous query resolved?</p>
    <div class="resolve-inline-actions">
      <button type="button" data-action="yes">Yes</button>
      <button type="button" data-action="no">No</button>
    </div>
  `;

  row.appendChild(bubble);
  chatWindow.appendChild(row);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  resolvePromptRendered = true;

  bubble.querySelector("[data-action='yes']")?.addEventListener("click", async () => {
    await resolvePreviousChat();
    cachedActiveHistory = [];
    resolvePromptRendered = false;
    setChatLocked(false);
    resetChatWindow();
  });

  bubble.querySelector("[data-action='no']")?.addEventListener("click", async () => {
    if (!cachedActiveHistory.length) {
      const historyPayload = await fetchActiveHistory();
      cachedActiveHistory = historyPayload.messages || [];
    }
    resolvePromptRendered = false;
    setChatLocked(false);
    if (cachedActiveHistory.length) {
      restoreChatHistory(cachedActiveHistory);
      return;
    }
    resetChatWindow();
  });
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

  const targetLang = activeLanguage === "hi" ? "hi" : "en";

  if (lang.startsWith(targetLang)) {
    score += 100;
  }
  
  if (targetLang === "en") {
    if (lang === "en-us") score += 15;
    if (/(samantha|zira|jenny|aria|allison|ava|female|woman|karen|moira)/.test(name)) score += 35;
  } else {
    if (lang === "hi-in") score += 20;
    if (/(madhur|kalpana|swara|hemant|female|woman)/.test(name)) score += 35;
  }

  if (voice.localService) {
    score += 45;
  } else {
    score -= 35;
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
  if (active) {
    setVoiceUiState("speaking");
  } else if (voiceUiState === "speaking") {
    setVoiceUiState("idle");
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

function hasActiveSpeech() {
  return Boolean(
    ("speechSynthesis" in window) &&
      (window.speechSynthesis.speaking || window.speechSynthesis.pending || isSpeaking)
  );
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

function saveVoiceSettings() {
  try {
    window.localStorage.setItem(VOICE_SETTINGS_STORAGE_KEY, JSON.stringify(voiceSettings));
  } catch (error) {
    // no-op
  }
}

function loadVoiceSettings() {
  try {
    const raw = window.localStorage.getItem(VOICE_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return false;
    }
    const parsed = JSON.parse(raw);
    const incomingStyle = parsed?.style;
    const incomingRate = Number(parsed?.rate);
    const incomingPitch = Number(parsed?.pitch);
    const incomingVolume = Number(parsed?.volume);

    if (typeof incomingStyle === "string" && voiceStylePresets[incomingStyle]) {
      voiceSettings.style = incomingStyle;
    }
    if (!Number.isNaN(incomingRate) && incomingRate >= 0.75 && incomingRate <= 1.15) {
      voiceSettings.rate = incomingRate;
    }
    if (!Number.isNaN(incomingPitch) && incomingPitch >= 0.85 && incomingPitch <= 1.35) {
      voiceSettings.pitch = incomingPitch;
    }
    if (!Number.isNaN(incomingVolume) && incomingVolume >= 0.4 && incomingVolume <= 1) {
      voiceSettings.volume = incomingVolume;
    }
    return true;
  } catch (error) {
    return false;
  }
}

function applyVoiceStyle(style) {
  const preset = voiceStylePresets[style];
  if (!preset) {
    return;
  }

  voiceSettings.style = style;
  voiceSettings.rate = preset.rate;
  voiceSettings.pitch = preset.pitch;
  voiceSettings.volume = preset.volume;
  saveVoiceSettings();
}

function resetChatWindow() {
  chatWindow.innerHTML = "";
  appendMessage(INITIAL_BOT_MESSAGE, "bot", "Now");
}

function restoreChatHistory(messages) {
  chatWindow.innerHTML = "";

  messages.forEach((entry) => {
    const senderType = entry.sender === "user" ? "user" : "bot";
    appendMessage(entry.message, senderType, formatTimestampLabel(entry.timestamp));
  });

}

async function fetchActiveHistory() {
  const response = await fetch("/get-chat-history");
  if (!response.ok) {
    return { has_active_chat: false, messages: [] };
  }
  return response.json();
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

async function sendChatMessage(message, lang = "en") {
  const response = await fetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, lang }),
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

  if (chatLockedByResolution) {
    return;
  }

  if (hasActiveSpeech()) {
    await interruptSpeechWithFade({ soft: true });
  }

  // If sending via text/button, exit voice mode visuals
  if (!options.fromVoice) {
    isVoiceMode = false;
    if (voiceOverlay && !voiceOverlay.hidden) {
      setVoiceUiState("idle");
    }
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
  const shouldSpeak = Boolean(options.shouldSpeak);

  const typingEl = appendTyping();

  try {
    const reply = await sendChatMessage(message, activeLanguage);
    window.setTimeout(() => {
      if (shouldSpeak) {
        speakText(reply, {
          onStart: () => {
            typingEl.remove?.();
            appendMessage(reply, "bot");
            if (voiceUiState !== "idle") {
              setVoiceUiState("idle");
            }
          },
        });
        return;
      }

      typingEl.remove?.();
      appendMessage(reply, "bot");
      if (voiceUiState !== "idle") {
        setVoiceUiState("idle");
      }
    }, BOT_RESPONSE_DELAY_MS);
  } catch (error) {
    window.setTimeout(() => {
      const fallback = "Sorry, this information is not available currently.";
      if (shouldSpeak) {
        speakText(fallback, {
          onStart: () => {
            typingEl.remove?.();
            appendMessage(fallback, "bot");
            if (voiceUiState !== "idle") {
              setVoiceUiState("idle");
            }
          },
        });
        return;
      }

      typingEl.remove?.();
      appendMessage(fallback, "bot");
      if (voiceUiState !== "idle") {
        setVoiceUiState("idle");
      }
    }, BOT_RESPONSE_DELAY_MS);
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
    }
  }
}

function startListening() {
  if (chatLockedByResolution) {
    return;
  }

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

  isVoiceMode = true;
  recognition = new SpeechRecognition();
  recognition.lang = activeLanguage === "hi" ? "hi-IN" : (navigator.language || "en-US");
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.continuous = true;
  let finalTranscript = "";
  let interimTranscript = "";
  let hasSubmittedTranscript = false;
  let finalizeTimer = null;

  const clearFinalizeTimer = () => {
    if (finalizeTimer) {
      window.clearTimeout(finalizeTimer);
      finalizeTimer = null;
    }
  };

  const submitTranscript = (sourceTranscript) => {
    const transcript = (sourceTranscript || "").trim();
    if (!transcript || hasSubmittedTranscript) {
      return false;
    }

    hasSubmittedTranscript = true;
    clearFinalizeTimer();
    setVoiceUiState("processing");
    chatInput.value = transcript;
    try {
      recognition.stop();
    } catch (error) {
      // no-op
    }
    handleSend(null, { fromVoice: true, shouldSpeak: true });
    return true;
  };

  const scheduleFastFinalize = (delay = 1200) => {
    clearFinalizeTimer();
    finalizeTimer = window.setTimeout(() => {
      submitTranscript(finalTranscript || interimTranscript);
      if (!hasSubmittedTranscript) {
        try {
          recognition.stop();
        } catch (error) {
          // no-op
        }
      }
    }, delay);
  };

  recognition.onstart = () => {
    isListening = true;
    setVoiceUiState("listening");
  };

  recognition.onresult = (event) => {
    let latestInterim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      if (event.results[i].isFinal) {
        finalTranscript += `${event.results[i][0].transcript} `;
      } else {
        latestInterim += `${event.results[i][0].transcript} `;
      }
    }

    if (latestInterim.trim()) {
      interimTranscript = latestInterim.trim();
    }

    if (submitTranscript(finalTranscript)) {
      return;
    }

    if (interimTranscript || finalTranscript) {
      scheduleFastFinalize(1200);
    }
  };

  recognition.onspeechend = () => {
    // With continuous: true, onspeechend is less critical but still a hint
    if (!hasSubmittedTranscript && (finalTranscript || interimTranscript)) {
      scheduleFastFinalize(1500);
    }
  };

  recognition.onend = () => {
    isListening = false;
    if (!hasSubmittedTranscript && (finalTranscript.trim() || interimTranscript.trim())) {
      submitTranscript(finalTranscript || interimTranscript);
    } else if (!hasSubmittedTranscript) {
      setVoiceUiState("idle");
    }
  };

  recognition.onnomatch = () => {
    const strings = UI_STRINGS[activeLanguage] || UI_STRINGS.en;
    appendMessage(strings.understanding_error, "bot");
    setVoiceUiState("idle");
  };

  recognition.onerror = (event) => {
    const strings = UI_STRINGS[activeLanguage] || UI_STRINGS.en;
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      alert(strings.mic_error);
    } else if (event.error === "no-speech" || event.error === "audio-capture") {
      appendMessage(strings.understanding_error, "bot");
    }

    if (voiceUiState !== "processing") {
      setVoiceUiState("idle");
    }
  };

  recognition.onend = () => {
    clearFinalizeTimer();
    isListening = false;
    if (!hasSubmittedTranscript) {
      submitTranscript(finalTranscript || interimTranscript);
    }
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
    if (hasActive) {
      setChatLocked(true);
      appendResolvePromptMessage();
      return;
    }
    setChatLocked(false);
  } catch (error) {
    setChatLocked(false);
  }
}

chatForm.addEventListener("submit", handleSend);

chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    if (chatLockedByResolution) {
      return;
    }
    const msg = (activeLanguage === "hi" && chip.dataset.msgHi) ? chip.dataset.msgHi : (chip.dataset.msg || "");
    chatInput.value = msg;
    handleSend(null, { shouldSpeak: true });
  });
});

if (micBtn) {
  micBtn.addEventListener("click", startListening);
}

if (closeVoiceBtn) {
  closeVoiceBtn.addEventListener("click", async () => {
    isVoiceMode = false;
    if (isListening) {
      await stopListeningIfNeeded();
    }
    if (hasActiveSpeech()) {
      await interruptSpeechWithFade({ soft: false });
    }
    setVoiceUiState("idle");
  });
}

if (chatInput) {
  chatInput.addEventListener("input", () => {
    if (hasActiveSpeech()) {
      interruptSpeechWithFade({ soft: true });
    }
  });
}

const logoutBtn = document.querySelector(".logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    if (hasActiveSpeech()) {
      await interruptSpeechWithFade({ soft: true });
    }
    window.location.href = logoutBtn.getAttribute("href") || "/logout";
  });
}

window.addEventListener("beforeunload", () => {
  if (!("speechSynthesis" in window)) {
    return;
  }
  if (hasActiveSpeech()) {
    try {
      window.speechSynthesis.pause();
      window.speechSynthesis.cancel();
      setSpeakingState(false);
    } catch (error) {
      // no-op
    }
  }
});

const hasStoredVoiceSettings = loadVoiceSettings();
if (!hasStoredVoiceSettings) {
  applyVoiceStyle("sweet");
}
saveVoiceSettings();

// Language Toggles initialization
function updateLangUI(lang) {
  activeLanguage = lang;
  localStorage.setItem("zappit_lang", lang);
  langBtns.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lang === lang);
  });
  applyLanguageToUI(lang);
  updatePreferredVoice();
}

function applyLanguageToUI(lang) {
  const strings = UI_STRINGS[lang] || UI_STRINGS.en;
  
  // Update static text elements
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (strings[key]) {
      el.textContent = strings[key];
    }
  });

  // Update placeholders
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (strings[key]) {
      el.placeholder = strings[key];
    }
  });

  // Update status pills specially if needed
  document.querySelectorAll(".status-pill").forEach(el => {
    const status = el.getAttribute("data-status"); // "preparing", "delivered", etc.
    const key = "status_" + status.replace(/\s+/g, "_");
    if (strings[key]) {
      el.textContent = strings[key];
    }
  });
}

langBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    updateLangUI(btn.dataset.lang);
  });
});

updateLangUI(activeLanguage);
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
