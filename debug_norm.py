import re
import unicodedata

def normalize_question(q: str) -> str:
    if not q:
        return ""
    q = q.lower()
    # Minimize punctuation removal
    punctuations = r'[!"#$%&\'()*+,-./:;<=>?@[\\\]^_`{|}~?।]'
    q = re.sub(punctuations, ' ', q)
    return " ".join(q.split())

text = "मेरा ऑर्डर कहाँ है?"
print(f"Original: {text}")
print(f"Normalized: {normalize_question(text)}")
