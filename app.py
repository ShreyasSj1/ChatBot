import os
import re
import sqlite3
import difflib
from typing import Optional, Tuple

from flask import Flask, jsonify, redirect, render_template, request, session, url_for


app = Flask(__name__)
app.secret_key = "replace_with_a_secure_secret_key"

DB_PATH = os.path.join(os.path.dirname(__file__), "chatbot.db")

FALLBACK_MESSAGE = "Sorry, this information is not available currently."
MIN_FAQ_MATCH_CONFIDENCE = 0.65
ACTIVE_ORDER_STATUSES = {"preparing", "out for delivery"}


def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS orders (
            order_id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL,
            item_name TEXT NOT NULL,
            status TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS faq (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question TEXT NOT NULL UNIQUE,
            answer TEXT NOT NULL
        )
        """
    )

    users = [(i, f"user{i}", f"pass{i}") for i in range(1, 6)]
    cur.executemany(
        "INSERT OR IGNORE INTO users (id, username, password) VALUES (?, ?, ?)", users
    )

    orders = [
        (1011, 1, "Paneer Tikka Wrap", "Preparing"),
        (1012, 1, "Masala Dosa", "Delivered"),
        (1021, 2, "Chicken Biryani", "Out for delivery"),
        (1022, 2, "Veg Momos", "Cancelled"),
        (1031, 3, "Farmhouse Pizza", "Delivered"),
        (1032, 3, "Chocolate Brownie", "Delivered"),
        (1033, 3, "Cold Coffee", "Preparing"),
        (1041, 4, "Aloo Paratha Combo", "Out for delivery"),
        (1051, 5, "Hakka Noodles", "Cancelled"),
        (1052, 5, "Gulab Jamun", "Delivered"),
    ]
    cur.executemany(
        "INSERT OR IGNORE INTO orders (order_id, user_id, item_name, status) VALUES (?, ?, ?, ?)",
        orders,
    )

    faq_entries = [
        (
            "How to track my order?",
            "Open the app dashboard and check your order list. You can also type 'order status <order_id>' in chat.",
        ),
        (
            "How to cancel an order?",
            "You can cancel an order only before the restaurant starts preparing it. Go to Order Details and tap Cancel.",
        ),
        (
            "What are delivery charges?",
            "Delivery charges depend on distance, restaurant policies, and surge conditions. The final fee is shown at checkout.",
        ),
        (
            "What if my order is late?",
            "If your order is delayed, please wait for status updates in tracking. If the delay is significant, contact support from the order page.",
        ),
        (
            "Can I change delivery address?",
            "Address changes are possible only before dispatch and only if the new address is within serviceable range.",
        ),
        (
            "How do I apply a coupon code?",
            "At checkout, enter your coupon in the promo code field and click Apply to see the updated total.",
        ),
        (
            "How can I contact customer support?",
            "Use the Help section in the app and select your order to start a support chat or request a callback.",
        ),
        (
            "What payment methods are accepted?",
            "We support UPI, credit/debit cards, net banking, and selected wallets depending on your location.",
        ),
        (
            "How do I request a refund?",
            "Open the order details, choose Help, and submit a refund request with your issue details.",
        ),
        (
            "Can I schedule an order for later?",
            "Yes, many restaurants allow scheduled delivery. Choose a future time slot during checkout if available.",
        ),
        (
            "Is there a minimum order amount?",
            "Some restaurants set a minimum order amount. If applicable, you will see it on the restaurant page before checkout.",
        ),
        (
            "How long does delivery usually take?",
            "Delivery time depends on restaurant preparation time, rider availability, traffic, and distance. You will see an ETA while placing and tracking your order.",
        ),
        (
            "Can I edit my order after placing it?",
            "Order edits are usually possible only before the restaurant starts preparing your food. Open order details and check if Edit is available.",
        ),
        (
            "What if an item is missing or wrong?",
            "Open the order in Help and report missing or incorrect items with details or photos for faster resolution.",
        ),
        (
            "Is cash on delivery available?",
            "Cash on delivery is available only for eligible orders and locations. You will see it as a payment option at checkout when supported.",
        ),
        (
            "How can I get an invoice for my order?",
            "After delivery, open order details and download the invoice or receipt from the billing section if available.",
        ),
        (
            "Can I reorder a previous order?",
            "Yes, go to your order history and use Reorder on any eligible past order.",
        ),
    ]
    cur.executemany(
        "INSERT OR IGNORE INTO faq (question, answer) VALUES (?, ?)",
        faq_entries,
    )

    conn.commit()
    conn.close()


def get_faq_questions(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute("SELECT question FROM faq ORDER BY id").fetchall()
    return [row["question"] for row in rows]


def get_faq_answer(conn: sqlite3.Connection, question: str) -> Optional[str]:
    row = conn.execute("SELECT answer FROM faq WHERE question = ?", (question,)).fetchone()
    return row["answer"] if row else None


def parse_order_status_query(message: str) -> Optional[int]:
    message = (message or "").strip()

    # Strict format: "order status <order_id>"
    match = re.fullmatch(r"order\s+status\s+(\d+)", message, flags=re.IGNORECASE)
    if not match:
        # Natural variants, e.g.:
        # "where is order 1011", "track order 1011", "status of order 1011"
        lower = message.lower()
        has_order_intent = any(
            token in lower for token in ["order", "track", "status", "where", "delivery"]
        )
        if not has_order_intent:
            return None
        id_match = re.search(r"\b(\d{3,})\b", message)
        if not id_match:
            return None
        return int(id_match.group(1))
    return int(match.group(1))


def is_order_status_intent(message: str) -> bool:
    tokens = token_set(message)
    return bool({"order"} & tokens and ({"track", "status", "where", "delivery"} & tokens))


def is_order_history_intent(message: str) -> bool:
    normalized = normalize_question(message)
    tokens = set(normalized.split())
    has_order_word = bool({"order", "orders"} & tokens)
    history_markers = {"past", "previous", "history", "all", "older", "recent", "list"}
    return has_order_word and bool(history_markers & tokens)


def build_all_orders_response(orders: list[sqlite3.Row]) -> str:
    if not orders:
        return "No orders found for your account right now."

    lines = ["Here are all your orders:"]
    for row in orders:
        lines.append(f"#{row['order_id']} ({row['item_name']}) - {row['status']}")
    return "\n".join(lines)


def build_order_selection_prompt(orders: list[sqlite3.Row], active_only: bool = False) -> str:
    if not orders:
        return "No orders found for your account right now."

    limited_orders = orders[:5]
    order_choices = ", ".join(
        f"#{row['order_id']} ({row['item_name']})" for row in limited_orders
    )

    if active_only:
        return (
            "You have multiple active orders. Please choose an order ID to proceed: "
            f"{order_choices}. You can type: order status <order_id>."
        )

    return (
        "I could not find an active order in Preparing/Out for delivery status. "
        f"Please choose an order ID and item to proceed: {order_choices}. "
        "You can type: order status <order_id>."
    )


def normalize_question(text: str) -> str:
    cleaned = (text or "").strip().strip("\"'`")
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = re.sub(r"[^\w\s]", "", cleaned.lower())
    return cleaned.strip()


def resolve_faq_question(raw_match: str, faq_questions: list[str]) -> Optional[str]:
    if not raw_match:
        return None
    direct = raw_match.strip()
    if direct in faq_questions:
        return direct

    normalized_map = {normalize_question(q): q for q in faq_questions}
    return normalized_map.get(normalize_question(direct))


def token_set(text: str) -> set[str]:
    words = [tok for tok in normalize_question(text).split() if tok]
    replacements = {
        "fee": "charges",
        "fees": "charges",
        "charge": "charges",
        "charged": "charges",
        "support": "help",
    }
    return {replacements.get(word, word) for word in words}


def faq_intent_rule_match(user_query: str, faq_questions: list[str]) -> Optional[str]:
    query = normalize_question(user_query)
    tokens = token_set(user_query)
    question_by_norm = {normalize_question(q): q for q in faq_questions}

    if {"order"} & tokens and ({"track", "status", "where", "delivery"} & tokens):
        return question_by_norm.get(normalize_question("How to track my order?"))
    if {"cancel", "cancellation"} & tokens:
        return question_by_norm.get(normalize_question("How to cancel an order?"))
    if {"delivery", "charges"} <= tokens or ("delivery" in tokens and "charges" in tokens):
        return question_by_norm.get(normalize_question("What are delivery charges?"))
    if {"late", "delay", "delayed"} & tokens and "order" in tokens:
        return question_by_norm.get(normalize_question("What if my order is late?"))
    if {"address", "change"} <= tokens:
        return question_by_norm.get(normalize_question("Can I change delivery address?"))
    if {"coupon", "code"} & tokens:
        return question_by_norm.get(normalize_question("How do I apply a coupon code?"))
    if {"contact", "help", "support"} & tokens:
        return question_by_norm.get(normalize_question("How can I contact customer support?"))
    if {"payment", "methods"} & tokens or {"upi", "card", "wallet"} & tokens:
        return question_by_norm.get(normalize_question("What payment methods are accepted?"))
    if {"refund"} & tokens:
        return question_by_norm.get(normalize_question("How do I request a refund?"))
    if {"schedule", "later"} & tokens:
        return question_by_norm.get(normalize_question("Can I schedule an order for later?"))
    if "minimum" in tokens and "order" in tokens:
        return question_by_norm.get(normalize_question("Is there a minimum order amount?"))
    if "delivery" in tokens and ({"time", "eta", "long", "arrive"} & tokens):
        return question_by_norm.get(normalize_question("How long does delivery usually take?"))
    if "order" in tokens and ({"edit", "modify", "change"} & tokens):
        return question_by_norm.get(normalize_question("Can I edit my order after placing it?"))
    if {"missing", "wrong", "incorrect"} & tokens and "item" in tokens:
        return question_by_norm.get(normalize_question("What if an item is missing or wrong?"))
    if ("cash" in tokens and "delivery" in tokens) or "cod" in query:
        return question_by_norm.get(normalize_question("Is cash on delivery available?"))
    if {"invoice", "receipt", "bill"} & tokens:
        return question_by_norm.get(normalize_question("How can I get an invoice for my order?"))
    if {"reorder", "repeat"} & tokens:
        return question_by_norm.get(normalize_question("Can I reorder a previous order?"))
    if "delivery" in tokens and ("fee" in query or "fees" in query or "kya hai" in user_query.lower()):
        return question_by_norm.get(normalize_question("What are delivery charges?"))
    return None


def faq_string_match(user_query: str, faq_questions: list[str]) -> Tuple[Optional[str], str]:
    """
    Returns (matched_question_or_none, reason) using string matching only.
    """
    if not faq_questions:
        return None, "no_questions"

    normalized_query = normalize_question(user_query)
    if not normalized_query:
        return None, "empty_query"

    # Direct normalized match
    direct = resolve_faq_question(user_query, faq_questions)
    if direct:
        return direct, "exact_normalized_match"

    intent_match = faq_intent_rule_match(user_query, faq_questions)
    if intent_match:
        return intent_match, "intent_rule_match"

    query_tokens = token_set(user_query)
    best_question: Optional[str] = None
    best_score = 0.0

    for question in faq_questions:
        question_norm = normalize_question(question)
        seq_score = difflib.SequenceMatcher(None, normalized_query, question_norm).ratio()

        q_tokens = token_set(question)
        overlap = len(query_tokens & q_tokens)
        coverage = overlap / max(1, len(q_tokens))
        token_score = (overlap / max(1, len(query_tokens)) + coverage) / 2

        # Blend character similarity with token overlap
        score = (0.65 * seq_score) + (0.35 * token_score)
        if score > best_score:
            best_score = score
            best_question = question

    if not best_question or best_score < MIN_FAQ_MATCH_CONFIDENCE:
        return None, "low_confidence"

    return best_question, "matched"


@app.route("/")
def index():
    if session.get("user_id"):
        return redirect(url_for("dashboard"))
    return render_template("login.html")


@app.route("/login", methods=["POST"])
def login():
    user_id = request.form.get("user_id", "").strip()
    password = request.form.get("password", "").strip()

    if not user_id.isdigit() or not password:
        return render_template("login.html", error="Invalid credentials.")

    conn = get_db_connection()
    user = conn.execute(
        "SELECT id, username FROM users WHERE id = ? AND password = ?",
        (int(user_id), password),
    ).fetchone()
    conn.close()

    if not user:
        return render_template("login.html", error="Invalid credentials.")

    session["user_id"] = user["id"]
    session["username"] = user["username"]
    return redirect(url_for("dashboard"))


@app.route("/dashboard")
def dashboard():
    if not session.get("user_id"):
        return redirect(url_for("index"))

    conn = get_db_connection()
    orders = conn.execute(
        "SELECT order_id, item_name, status FROM orders WHERE user_id = ? ORDER BY order_id DESC",
        (session["user_id"],),
    ).fetchall()
    conn.close()

    return render_template(
        "dashboard.html",
        username=session.get("username"),
        user_id=session.get("user_id"),
        orders=orders,
    )


@app.route("/chat", methods=["POST"])
def chat():
    if not session.get("user_id"):
        return jsonify({"reply": "Please login first."}), 401

    data = request.get_json(silent=True) or {}
    user_message = (data.get("message") or "").strip()
    if not user_message:
        return jsonify({"reply": FALLBACK_MESSAGE})

    conn = get_db_connection()

    if is_order_history_intent(user_message):
        user_orders = conn.execute(
            "SELECT order_id, item_name, status FROM orders WHERE user_id = ? ORDER BY order_id DESC",
            (session["user_id"],),
        ).fetchall()
        conn.close()
        return jsonify({"reply": build_all_orders_response(user_orders)})

    order_id = parse_order_status_query(user_message)
    if order_id is not None:
        row = conn.execute(
            "SELECT order_id, item_name, status FROM orders WHERE order_id = ? AND user_id = ?",
            (order_id, session["user_id"]),
        ).fetchone()
        conn.close()

        if row:
            return jsonify(
                {
                    "reply": (
                        f"Order #{row['order_id']} ({row['item_name']}) is currently: {row['status']}."
                    )
                }
            )
        return jsonify(
            {
                "reply": "Order not found for your account. Please check the order ID and try again."
            }
        )

    if is_order_status_intent(user_message):
        user_orders = conn.execute(
            "SELECT order_id, item_name, status FROM orders WHERE user_id = ? ORDER BY order_id DESC",
            (session["user_id"],),
        ).fetchall()
        active_orders = [
            row for row in user_orders if row["status"].strip().lower() in ACTIVE_ORDER_STATUSES
        ]

        if len(active_orders) == 1:
            row = active_orders[0]
            conn.close()
            return jsonify(
                {
                    "reply": (
                        f"Order #{row['order_id']} ({row['item_name']}) is currently: {row['status']}."
                    )
                }
            )

        if len(active_orders) > 1:
            prompt = build_order_selection_prompt(active_orders, active_only=True)
            conn.close()
            return jsonify({"reply": prompt})

        prompt = build_order_selection_prompt(user_orders, active_only=False)
        conn.close()
        return jsonify({"reply": prompt})

    faq_questions = get_faq_questions(conn)
    matched_question, reason = faq_string_match(user_message, faq_questions)

    if not matched_question:
        app.logger.info("FAQ fallback used. reason=%s query=%s", reason, user_message)
        conn.close()
        return jsonify({"reply": FALLBACK_MESSAGE})

    answer = get_faq_answer(conn, matched_question)
    conn.close()

    if not answer:
        return jsonify({"reply": FALLBACK_MESSAGE})

    return jsonify({"reply": answer})


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))


if __name__ == "__main__":
    init_db()
    app.run(debug=True)
