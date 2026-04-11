const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatWindow = document.getElementById("chat-window");

function appendMessage(text, type) {
  const msg = document.createElement("div");
  msg.className = `message ${type === "user" ? "user-message" : "bot-message"}`;
  msg.textContent = text;
  chatWindow.appendChild(msg);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return msg;
}

function appendTyping() {
  const wrap = document.createElement("div");
  wrap.className = "message bot-message typing-message";
  wrap.innerHTML = `
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
  `;
  chatWindow.appendChild(wrap);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  return wrap;
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

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) {
    return;
  }

  appendMessage(message, "user");
  chatInput.value = "";
  chatInput.focus();

  const typingEl = appendTyping();

  try {
    const reply = await sendChatMessage(message);
    setTimeout(() => {
      typingEl.remove();
      appendMessage(reply, "bot");
    }, 1200);
  } catch (error) {
    setTimeout(() => {
      typingEl.remove();
      appendMessage("Sorry, this information is not available currently.", "bot");
    }, 1200);
  }
});
