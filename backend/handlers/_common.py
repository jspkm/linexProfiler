"""Shared utilities used by handler modules.

Heavy imports are deferred to keep cold-start fast.
"""

import os
import functools


# --------------- Handler decorator ---------------

def handler(fn):
    """Decorator that wraps a handler with standard try/except -> (dict, 500)."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception as e:
            return {"error": str(e)}, 500
    return wrapper

# --------------- Write guard ---------------

def check_write_guard():
    """Return an (error_dict, 403) tuple if writes are blocked, else None."""
    from config import writes_allowed, write_block_reason

    if writes_allowed():
        return None
    return ({"error": write_block_reason()}, 403)


# --------------- Lazy CardCatalog singleton ---------------

_catalog = None


def get_catalog():
    """Lazy-init CardCatalog on first use."""
    global _catalog
    if _catalog is None:
        from cards.catalog import CardCatalog
        from config import CARDS_PATH

        _catalog = CardCatalog(str(CARDS_PATH))
    return _catalog


# --------------- Source snippet cache ---------------

_source_snippets = None


def get_source_snippets():
    """Load and cache backend source files used to answer methodology questions."""
    global _source_snippets
    if _source_snippets is not None:
        return _source_snippets

    snippets = {}
    src_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "profile_generator")
    for fname in ("optimization.py", "incentive_manager.py", "trainer.py"):
        fpath = os.path.join(src_dir, fname)
        try:
            with open(fpath, "r") as f:
                snippets[fname] = f.read()
        except Exception:
            pass

    _source_snippets = snippets
    return _source_snippets


# --------------- LLM call wrapper ---------------

def llm_call(system, contents, temperature=0.3, max_output_tokens=4000):
    """Make a Gemini API call and return the raw text response.

    *contents* may be a plain string (single-turn) or a list of
    ``google.genai.types.Content`` objects (multi-turn).
    """
    from google import genai
    from google.genai import types
    from config import GEMINI_API_KEY, MODEL

    client = genai.Client(api_key=GEMINI_API_KEY)
    response = client.models.generate_content(
        model=MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        ),
    )
    return response.text.strip()


# --------------- Markdown fence stripper ---------------

def strip_fences(raw):
    """Strip leading/trailing markdown code fences from *raw*."""
    if not raw.startswith("```"):
        return raw
    lines = raw.split("\n")
    clean = []
    in_block = False
    for line in lines:
        if line.startswith("```") and not in_block:
            in_block = True
            continue
        if line.startswith("```") and in_block:
            break
        if in_block:
            clean.append(line)
    return "\n".join(clean)
