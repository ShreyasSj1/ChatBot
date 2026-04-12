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
MIN_FAQ_MATCH_CONFIDENCE = 0.6
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

    # Added: persistent chat continuity storage
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            message TEXT NOT NULL,
            sender TEXT NOT NULL CHECK (sender IN ('user', 'bot')),
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            active INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_chat_history_user_active
        ON chat_history (user_id, active, id)
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
        # Hindi FAQs
        (
            "मेरा ऑर्डर कैसे ट्रैक करें?",
            "ऐप डैशबोर्ड खोलें और अपनी ऑर्डर सूची जांचें। आप चैट में 'ऑर्डर स्टेटस <ऑर्डर_आईडी>' भी टाइप कर सकते हैं।",
        ),
        (
            "ऑर्डर कैसे रद्द करें?",
            "आप ऑर्डर केवल तभी रद्द कर सकते हैं जब रेस्तरां इसे तैयार करना शुरू न करे। ऑर्डर विवरण पर जाएं और रद्द करें पर टैप करें।",
        ),
        (
            "डिलिवरी शुल्क क्या हैं?",
            "डिलिवरी शुल्क दूरी, रेस्तरां नीतियों और मांग पर निर्भर करते हैं। अंतिम शुल्क चेकआउट पर दिखाई देता है।",
        ),
        (
            "अगर मेरा ऑर्डर लेट हो जाए तो क्या करें?",
            "यदि आपके ऑर्डर में देरी होती है, तो कृपया ट्रैकिंग में स्टेटस अपडेट के लिए प्रतीक्षा करें। यदि देरी अधिक है, तो सपोर्ट से संपर्क करें।",
        ),
        (
            "क्या मैं डिलिवरी पता बदल सकता हूँ?",
            "पता बदलना केवल डिस्पैच से पहले संभव है और यदि नया पता सेवा क्षेत्र के भीतर है।",
        ),
        (
            "कूपन कोड कैसे लगाएं?",
            "चेकआउट पर, प्रोमो कोड फ़ील्ड में अपना कूपन दर्ज करें और अपडेट किया गया कुल देखने के लिए अप्लाई पर क्लिक करें।",
        ),
        (
            "ग्राहक सहायता से कैसे संपर्क करें?",
            "ऐप में सहायता अनुभाग का उपयोग करें और सहायता चैट शुरू करने या कॉल बैंक का अनुरोध करने के लिए अपना ऑर्डर चुनें।",
        ),
        (
            "कौन से पेमेंट तरीके स्वीकार किए जाते हैं?",
            "हम यूपीआई, क्रेडिट/देबिट कार्ड, नेट बैंकिंग और वॉलेट का समर्थन करते हैं।",
        ),
        (
            "मैं रिफंड का अनुरोध कैसे करूँ?",
            "ऑर्डर विवरण खोलें, सहायता चुनें और अपने समस्या विवरण के साथ रिफंड अनुरोध सबमिट करें।",
        ),
        (
            "क्या मैं बाद के लिए ऑर्डर शेड्यूल कर सकता हूँ?",
            "हाँ, कई रेस्तरां शेड्यूल डिलिवरी की अनुमति देते हैं। चेकआउट के दौरान भविष्य का समय चुनें।",
        ),
        (
            "क्या कोई न्यूनतम ऑर्डर राशि है?",
            "कुछ रेस्तरां न्यूनतम ऑर्डर राशि निर्धारित करते हैं। यदि लागू हो, तो आप इसे रेस्तरां पेज पर देखेंगे।",
        ),
        (
            "डिलिवरी में आमतौर पर कितना समय लगता है?",
            "डिलिवरी का समय तैयारी, राइडर की उपलब्धता और दूरी पर निर्भर करता है। आपको चेकआउट के दौरान ईटीए दिखाई देगा।",
        ),
        (
            "क्या मैं ऑर्डर देने के बाद उसे एडिट कर सकता हूँ?",
            "ऑर्डर एडिट आमतौर पर केवल तैयारी शुरू होने से पहले संभव होता है। विवरण में जाकर 'एडिट' विकल्प जांचें।",
        ),
        (
            "अगर कोई आइटम गायब या गलत है तो क्या करें?",
            "सहायता में ऑर्डर खोलें और तेज़ समाधान के लिए गायब या गलत आइटम की रिपोर्ट करें।",
        ),
        (
            "क्या कैश ऑन डिलिवरी उपलब्ध है?",
            "कैश ऑन डिलिवरी केवल पात्र ऑर्डर और स्थानों के लिए उपलब्ध है। यह चेकआउट पर विकल्प के रूप में दिखेगा।",
        ),
        (
            "मैं अपने ऑर्डर का इनवॉइस कैसे प्राप्त कर सकता हूँ?",
            "डिलिवरी के बाद, ऑर्डर विवरण खोलें और बिलिंग अनुभाग से इनवॉइस डाउनलोड करें।",
        ),
        (
            "क्या मैं पिछला ऑर्डर फिर से दे सकता हूँ?",
            "हाँ, अपने ऑर्डर इतिहास पर जाएँ और किसी भी पात्र पिछले ऑर्डर पर 'रीऑर्डर' का उपयोग करें।",
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


def has_active_chat(conn: sqlite3.Connection, user_id: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM chat_history WHERE user_id = ? AND active = 1 LIMIT 1",
        (user_id,),
    ).fetchone()
    return bool(row)


def save_chat_exchange(
    conn: sqlite3.Connection, user_id: int, user_message: str, bot_message: str
) -> None:
    conn.execute(
        "INSERT INTO chat_history (user_id, message, sender, active) VALUES (?, ?, 'user', 1)",
        (user_id, user_message),
    )
    conn.execute(
        "INSERT INTO chat_history (user_id, message, sender, active) VALUES (?, ?, 'bot', 1)",
        (user_id, bot_message),
    )
    conn.commit()


def get_faq_answer(conn: sqlite3.Connection, question: str) -> Optional[str]:
    row = conn.execute("SELECT answer FROM faq WHERE question = ?", (question,)).fetchone()
    return row["answer"] if row else None


def parse_order_status_query(message: str) -> Optional[int]:
    message = (message or "").strip()

    # Strict format: "order status <order_id>"
    match = re.fullmatch(r"order\s+status\s+(\d+)", message, flags=re.IGNORECASE)
    if not match:
        # Hindi support for order status
        hindi_match = re.search(r"(?:ऑर्डर|क्रम)\s+(?:स्टेटस|स्थिति|नंबर)?\s*(\d+)", message)
        if hindi_match:
            return int(hindi_match.group(1))

        # Natural variants, e.g.:
        # "where is order 1011", "track order 1011", "status of order 1011"
        lower = message.lower()
        has_order_intent = any(
            token in lower for token in ["order", "track", "status", "where", "delivery", "ऑर्डर", "ट्रैक", "स्टेटस", "कहाँ", "डिलिवरी"]
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
    english_intent = bool({"order"} & tokens and ({"track", "status", "where", "delivery"} & tokens))
    hindi_intent = "ऑर्डर" in message and any(tok in message for tok in ["स्टेटस", "स्थिति", "कहाँ", "ट्रैक"])
    return english_intent or hindi_intent


def normalize_question(q: str) -> str:
    if not q:
        return ""
    q = q.lower()
    # Remove standard punctuation but keep all Unicode word characters (including Hindi matras)
    # Using a safer approach: keep letters, numbers, and whitespace.
    # In Python 3, q.isalnum() works for Hindi too.
    # We'll replace punctuation with space.
    punctuations = r'[!"#$%&\'()*+,-./:;<=>?@[\\\]^_`{|}~?।]'
    q = re.sub(punctuations, ' ', q)
    return " ".join(q.split())


def is_order_history_intent(message: str) -> bool:
    msg = normalize_question(message)
    # Check for history markers
    history_markers = ['history', 'previous', 'past', 'all orders', 'my orders', 'पुराने', 'पिछले', 'इतिहास', 'सूची', 'सारे ऑर्डर', 'मेरे ऑर्डर', 'सब']
    if any(k in msg for k in history_markers):
        # Must also have a hint of 'order' unless it's a very specific history word
        if any(k in msg for k in ['order', 'ऑर्डर', 'आर्डर', 'बुक']):
            return True
        if any(k in msg for k in ['पुराने', 'इतिहास', 'सूची']):
            return True
    return False


def build_all_orders_response(orders: list[sqlite3.Row], lang: str = 'en') -> str:
    if not orders:
        return "No orders found for your account right now." if lang == 'en' else "अभी आपके खाते में कोई ऑर्डर नहीं मिला है।"

    header = "Here are all your orders:" if lang == 'en' else "ये रहे आपके सभी ऑर्डर:"
    lines = [header]
    
    status_map = {
        "Preparing": "तैयार हो रहा है",
        "Delivered": "डिलिवर हो गया",
        "Out for delivery": "डिलिवरी के लिए निकल गया",
        "Cancelled": "रद्द कर दिया गया"
    }

    for row in orders:
        status_text = row['status']
        if lang == 'hi':
            status_text = status_map.get(row['status'], row['status'])
        lines.append(f"#{row['order_id']} ({row['item_name']}) - {status_text}")
    return "\n".join(lines)


def build_order_selection_prompt(orders: list[sqlite3.Row], active_only: bool = False, lang: str = 'en') -> str:
    if not orders:
        return "No orders found for your account right now." if lang == 'en' else "अभी आपके खाते में कोई ऑर्डर नहीं मिला है।"

    limited_orders = orders[:5]
    order_choices = ", ".join(
        f"#{row['order_id']} ({row['item_name']})" for row in limited_orders
    )

    if lang == 'hi':
        if active_only:
            return (
                "आपके पास एक से अधिक सक्रिय ऑर्डर हैं। कृपया आगे बढ़ने के लिए एक ऑर्डर आईडी चुनें: "
                f"{order_choices}। आप टाइप कर सकते हैं: ऑर्डर स्टेटस <ऑर्डर_आईडी>।"
            )
        return (
            "मुझे 'तैयारी/डिलिवरी के लिए निकले' स्टेटस में कोई सक्रिय ऑर्डर नहीं मिला। "
            f"कृपया आगे बढ़ने के लिए एक ऑर्डर आईडी और आइटम चुनें: {order_choices}। "
            "आप टाइप कर सकते हैं: ऑर्डर स्टेटस <ऑर्डर_आईडी>।"
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


def faq_intent_rule_match(user_query: str, faq_questions: list[str], lang: str = "en") -> Optional[str]:
    query_norm = normalize_question(user_query)
    tokens = token_set(user_query)
    question_by_norm = {normalize_question(q): q for q in faq_questions}

    def get_q(en_q, hi_q):
        target = en_q if lang == "en" else hi_q
        return question_by_norm.get(normalize_question(target))

    if {"order"} & tokens and ({"track", "status", "where", "delivery"} & tokens):
        return get_q("How to track my order?", "मेरा ऑर्डर कैसे ट्रैक करें?")
    if {"cancel", "cancellation"} & tokens or any(k in query_norm for k in ["रद्द", "कैंसिल", "वापस"]):
        return get_q("How to cancel an order?", "ऑर्डर कैसे रद्द करें?")
    if ({"delivery", "charges"} <= tokens or ("delivery" in tokens and "charges" in tokens) or any(k in query_norm for k in ["शुल्क", "चार्ज"])):
        return get_q("What are delivery charges?", "डिलिवरी शुल्क क्या हैं?")
    if {"missing", "wrong", "item"} & tokens or any(k in query_norm for k in ["गायब", "गलत", "आइटम", "सामान", "कम"]):
        return get_q("What if an item is missing or wrong?", "अगर कोई आइटम गायब या गलत है तो क्या करें?")
    if {"late", "delay", "delayed"} & tokens and "order" in tokens:
        return get_q("What if my order is late?", "अगर मेरा ऑर्डर लेट हो जाए तो क्या करें?")
    if {"address", "change"} <= tokens:
        return get_q("Can I change delivery address?", "क्या मैं डिलिवरी पता बदल सकता हूँ?")
    if {"coupon", "code"} & tokens:
        return get_q("How do I apply a coupon code?", "कूपन कोड कैसे लगाएं?")
    if any(k in query_norm for k in ["support", "contact", "help", "agent", "human", "सपोर्ट", "संपर्क", "मदद", "सहायता", "बात करनी है", "कस्टमर"]):
        return get_q("How can I contact customer support?", "ग्राहक सहायता से कैसे संपर्क करें?")
    if {"payment", "methods"} & tokens or {"upi", "card", "wallet"} & tokens or any(k in query_norm for k in ["पेमेंट", "भुगतान", "पैसा"]):
        return get_q("What payment methods are accepted?", "कौन से पेमेंट तरीके स्वीकार किए जाते हैं?")
    if {"refund"} & tokens or "रिफंड" in query_norm:
        return get_q("How do I request a refund?", "मैं रिफंड का अनुरोध कैसे करूँ?")
    if {"schedule", "later"} & tokens or "शेड्यूल" in query_norm:
        return get_q("Can I schedule an order for later?", "क्या मैं बाद के लिए ऑर्डर शेड्यूल कर सकता हूँ?")
    if ("minimum" in tokens and "order" in tokens) or "न्यूनतम" in query_norm:
        return get_q("Is there a minimum order amount?", "क्या कोई न्यूनतम ऑर्डर राशि है?")
    if "delivery" in tokens and ({"time", "eta", "long", "arrive"} & tokens) or ("समय" in query_norm and "डिलिवरी" in query_norm):
        return get_q("How long does delivery usually take?", "डिलिवरी में आमतौर पर कितना समय लगता है?")
    if "order" in tokens and ({"edit", "modify", "change"} & tokens) or ("एडिट" in query_norm or "बदलाव" in query_norm):
        return get_q("Can I edit my order after placing it?", "क्या मैं ऑर्डर देने के बाद उसे एडिट कर सकता हूँ?")
    if {"missing", "wrong", "incorrect"} & tokens and "item" in tokens or ("गायब" in query_norm or "गलत" in query_norm):
        return get_q("What if an item is missing or wrong?", "अगर कोई आइटम गायब या गलत है तो क्या करें?")
    if (("cash" in tokens and "delivery" in tokens) or "cod" in query_norm or "नकद" in query_norm or "कैश" in query_norm):
        return get_q("Is cash on delivery available?", "क्या कैश ऑन डिलिवरी उपलब्ध है?")
    if {"invoice", "receipt", "bill"} & tokens or any(k in query_norm for k in ["इनवॉइस", "बिल"]):
        return get_q("How can I get an invoice for my order?", "मैं अपने ऑर्डर का इनवॉइस कैसे प्राप्त कर सकता हूँ?")
    if {"reorder", "repeat"} & tokens or any(k in query_norm for k in ["रीऑर्डर", "दोबारा"]):
        return get_q("Can I reorder a previous order?", "क्या मैं पिछला ऑर्डर फिर से दे सकता हूँ?")

    return None


def faq_string_match(user_query: str, faq_questions: list[str], lang: str = "en") -> Tuple[Optional[str], str]:
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

    intent_match = faq_intent_rule_match(user_query, faq_questions, lang=lang)
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
    active_chat_exists = has_active_chat(conn, int(session["user_id"]))
    conn.close()

    return render_template(
        "dashboard.html",
        username=session.get("username"),
        user_id=session.get("user_id"),
        orders=orders,
        has_active_chat=active_chat_exists,
    )


@app.route("/chat", methods=["POST"])
def chat():
    if not session.get("user_id"):
        return jsonify({"reply": "Please login first."}), 401

    data = request.get_json(silent=True) or {}
    user_message = (data.get("message") or "").strip()
    lang = data.get("lang", "en")
    
    status_map_hi = {
        "Preparing": "तैयार हो रहा है",
        "Delivered": "डिलिवर हो गया",
        "Out for delivery": "डिलिवरी के लिए निकल गया",
        "Cancelled": "रद्द कर दिया गया"
    }

    if not user_message:
        return jsonify({"reply": FALLBACK_MESSAGE})

    conn = get_db_connection()
    reply = FALLBACK_MESSAGE

    if is_order_history_intent(user_message):
        user_orders = conn.execute(
            "SELECT order_id, item_name, status FROM orders WHERE user_id = ? ORDER BY order_id DESC",
            (session["user_id"],),
        ).fetchall()
        reply = build_all_orders_response(user_orders, lang=lang)
        save_chat_exchange(conn, int(session["user_id"]), user_message, reply)
        conn.close()
        return jsonify({"reply": reply})

    order_id = parse_order_status_query(user_message)
    if order_id is not None:
        row = conn.execute(
            "SELECT order_id, item_name, status FROM orders WHERE order_id = ? AND user_id = ?",
            (order_id, session["user_id"]),
        ).fetchone()
        if row:
            if lang == 'hi':
                s = status_map_hi.get(row['status'], row['status'])
                reply = f"ऑर्डर #{row['order_id']} ({row['item_name']}) का वर्तमान स्टेटस है: {s}।"
            else:
                reply = f"Order #{row['order_id']} ({row['item_name']}) is currently: {row['status']}."
        else:
            reply = "Order not found for your account." if lang == 'en' else "आपके खाते के लिए ऑर्डर नहीं मिला।"
        save_chat_exchange(conn, int(session["user_id"]), user_message, reply)
        conn.close()
        return jsonify({"reply": reply})

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
            if lang == 'hi':
                s = status_map_hi.get(row['status'], row['status'])
                reply = f"ऑर्डर #{row['order_id']} ({row['item_name']}) का वर्तमान स्टेटस है: {s}।"
            else:
                reply = f"Order #{row['order_id']} ({row['item_name']}) is currently: {row['status']}."
            save_chat_exchange(conn, int(session["user_id"]), user_message, reply)
            conn.close()
            return jsonify({"reply": reply})

        if len(active_orders) > 1:
            reply = build_order_selection_prompt(active_orders, active_only=True, lang=lang)
            save_chat_exchange(conn, int(session["user_id"]), user_message, reply)
            conn.close()
            return jsonify({"reply": reply})

        reply = build_order_selection_prompt(user_orders, active_only=False, lang=lang)
        save_chat_exchange(conn, int(session["user_id"]), user_message, reply)
        conn.close()
        return jsonify({"reply": reply})

    faq_questions = get_faq_questions(conn)
    matched_question, reason = faq_string_match(user_message, faq_questions, lang=lang)

    if not matched_question:
        app.logger.info("FAQ fallback used. reason=%s query=%s", reason, user_message)
        save_chat_exchange(conn, int(session["user_id"]), user_message, FALLBACK_MESSAGE)
        conn.close()
        return jsonify({"reply": FALLBACK_MESSAGE})

    answer = get_faq_answer(conn, matched_question)
    reply = answer if answer else FALLBACK_MESSAGE
    save_chat_exchange(conn, int(session["user_id"]), user_message, reply)
    conn.close()

    if not answer:
        return jsonify({"reply": reply})

    return jsonify({"reply": reply})


@app.route("/get-chat-history")
def get_chat_history():
    if not session.get("user_id"):
        return jsonify({"error": "Please login first."}), 401

    conn = get_db_connection()
    rows = conn.execute(
        """
        SELECT message, sender, timestamp
        FROM chat_history
        WHERE user_id = ? AND active = 1
        ORDER BY id ASC
        """,
        (session["user_id"],),
    ).fetchall()
    conn.close()

    messages = [
        {
            "message": row["message"],
            "sender": row["sender"],
            "timestamp": row["timestamp"],
        }
        for row in rows
    ]
    return jsonify({"has_active_chat": bool(messages), "messages": messages})


@app.route("/resolve-chat", methods=["POST"])
def resolve_chat():
    if not session.get("user_id"):
        return jsonify({"error": "Please login first."}), 401

    conn = get_db_connection()
    conn.execute(
        "UPDATE chat_history SET active = 0 WHERE user_id = ? AND active = 1",
        (session["user_id"],),
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True})


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("index"))


if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5005)
