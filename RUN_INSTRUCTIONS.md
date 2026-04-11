# Run Instructions

## 1) Install dependencies

```bash
pip install flask requests
```

If `pip` maps to Python 2, use:

```bash
pip3 install flask requests
```

## 2) Add Gemini API key

Open `/Users/sj/Desktop/chatbot/app.py` and update:

```python
GEMINI_API_KEY = "PASTE_YOUR_GEMINI_API_KEY_HERE"
```

## 3) Start the application

```bash
python app.py
```

If `python` is not available, use:

```bash
python3 app.py
```

## 4) Open in browser

Visit:

`http://127.0.0.1:5000`

## 5) Demo login credentials

- User IDs: `1`, `2`, `3`, `4`, `5`
- Passwords: `pass1`, `pass2`, `pass3`, `pass4`, `pass5`

## 6) Test chatbot quickly

- Order status format: `order status 1011`
- FAQ example: `How can I contact support?`

## 7) Troubleshooting Gemini

- If all FAQ queries return fallback, check Flask terminal logs for: `FAQ fallback used. reason=...`
- The app now tries free-tier models in this order:
  - `gemini-2.5-flash`
  - `gemini-2.0-flash`
  - `gemini-2.0-flash-lite`
- If all configured free-tier models are unavailable or quota exhausted, chat returns:
  - `Sorry, our AI service is busy due to free-tier limits. Please try again shortly.`
- `gemini_http_error_NOT_FOUND` means a model is not available for your key/project.
- `gemini_http_error_RESOURCE_EXHAUSTED` means that model quota is exhausted or not enabled.
- `gemini_request_exception` usually means network/DNS access issue from your runtime environment.
