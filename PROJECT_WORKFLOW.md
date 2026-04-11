# Project Working (Simple Explanation)

## 1) What this project is

This is a customer support chatbot web app built with Flask.
It has:

- Login system
- User dashboard with order history
- Chatbot for order help + FAQ help

The chatbot gives answers only from your database FAQs (no external answer generation).

---

## 2) Tech stack and why it is used

- **Python Flask (Backend):** Handles routes, login logic, session handling, and chatbot API.
- **SQLite (Database):** Stores users, orders, and FAQ questions/answers in a lightweight local DB.
- **HTML (Frontend structure):** Builds login and dashboard pages.
- **CSS (Frontend styling):** Gives UI with cards, chat bubbles, table, and responsive layout.
- **Vanilla JavaScript (Frontend behavior):** Sends chat messages with `fetch()`, updates chat in real-time, and shows typing animation.

---

## 3) System design (high level)

There are 3 layers:

1. **Frontend (browser)**
2. **Flask backend (business logic)**
3. **SQLite database (data storage)**

Flow:

- User interacts in browser
- Browser sends requests to Flask routes
- Flask reads/writes SQLite
- Flask sends response back to browser

---

## 4) Database design

### `users`

- `id` (Primary Key)
- `username`
- `password`

### `orders`

- `order_id` (Primary Key)
- `user_id` (Foreign Key to users.id)
- `item_name`
- `status`

### `faq`

- `id` (Primary Key)
- `question`
- `answer`

On app start, DB is auto-created and seeded with demo data.

---

## 5) Main routes and what they do

- `/`Shows login page (or redirects to dashboard if already logged in).
- `/login` (POST)Validates `user_id + password` from SQLite and starts session.
- `/dashboard`Protected page. Shows username and that user’s orders.
- `/chat` (POST, AJAX)Chatbot endpoint. Accepts user message and returns bot reply.
- `/logout`
  Clears session and returns to login.

---

## 6) Chatbot workflow (step-by-step)

When user sends a message:

1. Flask receives message at `/chat`.
2. It first checks if message is an order-status query (like `order status 1011` or similar variants).
3. If order ID is found:
   - It fetches that order for logged-in user only.
   - Returns current status.
4. If not an order-status query:
   - It compares user message with FAQ questions using string matching logic:
     - normalized exact match
     - intent-rule mapping (common natural phrases)
     - fuzzy similarity scoring
5. If a confident FAQ match is found:
   - Fetch answer from `faq` table
   - Return that answer
6. If no confident match:
   - Return fallback:
     `Sorry, this information is not available currently.`

Important: chatbot answers are always fetched from DB FAQs only.

---

## 7) Frontend workflow

On dashboard:

- Left panel: order history table
- Right panel: chatbot

When user clicks **Send**:

1. JS appends user message bubble
2. Shows typing animation
3. Sends message to `/chat` using `fetch()`
4. Receives bot reply JSON
5. Replaces typing animation with bot message bubble

---

## 8) Security and session basics

- Flask session tracks logged-in user (`user_id`, `username`).
- Protected routes check session before allowing access.
- `app.secret_key` signs session cookies to prevent tampering.
- Order status is restricted to logged-in user’s own orders.

---

## 9) File structure and responsibility

- `/Users/sj/Desktop/chatbot/app.py`Backend logic, DB init, routes, chatbot matching.
- `/Users/sj/Desktop/chatbot/templates/login.html`Login UI.
- `/Users/sj/Desktop/chatbot/templates/dashboard.html`Dashboard UI + chat container.
- `/Users/sj/Desktop/chatbot/static/style.css`All styling and responsive design.
- `/Users/sj/Desktop/chatbot/static/script.js`Chat interactions and typing effect.
- `/Users/sj/Desktop/chatbot/chatbot.db`
  SQLite database (auto-created).

---

## 10) End-to-end summary

This app is a clean local full-stack project where:

- Flask handles app logic
- SQLite stores all business data
- JS makes chatbot feel real-time
- Bot responses are controlled and safe because answers come only from stored FAQs
