const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatWindow = document.getElementById("chat-window");
const sendBtn = document.getElementById("send-btn");
const chips = document.querySelectorAll(".chip");

function getTimeLabel() {
  const now = new Date();
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

async function handleSend(event) {
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

  const typingEl = appendTyping();

  try {
    const reply = await sendChatMessage(message);
    setTimeout(() => {
      typingEl.remove?.();
      appendMessage(reply, "bot");
    }, 1200);
  } catch (error) {
    setTimeout(() => {
      typingEl.remove?.();
      appendMessage("Sorry, this information is not available currently.", "bot");
    }, 1200);
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.textContent = "Send";
    }
  }
}

chatForm.addEventListener("submit", handleSend);

chips.forEach((chip) => {
  chip.addEventListener("click", () => {
    chatInput.value = chip.dataset.msg || "";
    handleSend();
  });
});
