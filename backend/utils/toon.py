"""TOON (Token-Oriented Object Notation) encoder and decoder.

Implements the TOON spec from https://github.com/toon-format/toon
- Indentation-based nesting (like YAML)
- Tabular encoding for uniform arrays of objects: arrayName[count]{field1,field2,...}:
- ~40% fewer tokens than standard JSON
"""

from __future__ import annotations

import re
from typing import Any


def encode(data: Any, name: str = "") -> str:
    """Encode a Python object into TOON format.

    Handles:
    - Primitives (str, int, float, bool, None)
    - Dicts (indented key: value)
    - Lists of uniform dicts (tabular format)
    - Lists of primitives (inline comma-separated)
    """
    return _encode_value(data, name, indent=0)


def _encode_value(value: Any, key: str, indent: int) -> str:
    prefix = " " * indent

    if value is None:
        return f"{prefix}{key}: null" if key else f"{prefix}null"

    if isinstance(value, bool):
        v = "true" if value else "false"
        return f"{prefix}{key}: {v}" if key else f"{prefix}{v}"

    if isinstance(value, (int, float)):
        return f"{prefix}{key}: {value}" if key else f"{prefix}{value}"

    if isinstance(value, str):
        safe = _escape_string(value)
        return f"{prefix}{key}: {safe}" if key else f"{prefix}{safe}"

    if isinstance(value, list):
        return _encode_list(value, key, indent)

    if isinstance(value, dict):
        return _encode_dict(value, key, indent)

    # Fallback: convert to string
    return f"{prefix}{key}: {value}" if key else f"{prefix}{value}"


def _escape_string(s: str) -> str:
    """Quote string only if it contains special characters."""
    if not s:
        return '""'
    if any(c in s for c in (",", ":", "\n", '"')) or s in ("true", "false", "null"):
        escaped = s.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return s


def _encode_dict(d: dict, key: str, indent: int) -> str:
    prefix = " " * indent
    lines = []
    if key:
        lines.append(f"{prefix}{key}:")
    for k, v in d.items():
        lines.append(_encode_value(v, str(k), indent + 1))
    return "\n".join(lines)


def _encode_list(lst: list, key: str, indent: int) -> str:
    if not lst:
        return f"{' ' * indent}{key}[0]:" if key else ""

    # Check if all items are uniform dicts (same keys)
    if all(isinstance(item, dict) for item in lst):
        all_keys = [tuple(sorted(item.keys())) for item in lst]
        if len(set(all_keys)) == 1 and all_keys[0]:
            return _encode_tabular(lst, key, indent)

    # Check if all items are primitives
    if all(isinstance(item, (str, int, float, bool)) or item is None for item in lst):
        vals = ",".join(_primitive_to_str(v) for v in lst)
        prefix = " " * indent
        if key:
            return f"{prefix}{key}[{len(lst)}]: {vals}"
        return f"{prefix}{vals}"

    # Mixed/nested list: encode each item
    prefix = " " * indent
    lines = []
    if key:
        lines.append(f"{prefix}{key}[{len(lst)}]:")
    for item in lst:
        lines.append(_encode_value(item, "", indent + 1))
    return "\n".join(lines)


def _encode_tabular(items: list[dict], key: str, indent: int) -> str:
    """Encode uniform array of dicts in TOON tabular format."""
    prefix = " " * indent
    fields = list(items[0].keys())
    header = f"{prefix}{key}[{len(items)}]{{{','.join(fields)}}}:"

    rows = []
    for item in items:
        vals = []
        for f in fields:
            vals.append(_primitive_to_str(item[f]))
        rows.append(f"{prefix} {','.join(vals)}")

    return "\n".join([header] + rows)


def _primitive_to_str(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, str):
        if any(c in v for c in (",", ":", "\n", '"')):
            escaped = v.replace("\\", "\\\\").replace('"', '\\"')
            return f'"{escaped}"'
        return v
    return str(v)


# --- Decoder ---

def decode(toon_text: str) -> Any:
    """Decode a TOON string back into Python objects.

    Handles tabular arrays, indented dicts, and inline primitives.
    """
    lines = toon_text.split("\n")
    result, _ = _parse_block(lines, 0, 0)
    return result


def _get_indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _parse_primitive(s: str) -> Any:
    s = s.strip()
    if s == "null":
        return None
    if s == "true":
        return True
    if s == "false":
        return False
    if s.startswith('"') and s.endswith('"'):
        return s[1:-1].replace('\\"', '"').replace("\\\\", "\\")
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return float(s)
    except ValueError:
        pass
    return s


_TABULAR_RE = re.compile(r"^(\s*)(\w+)\[(\d+)\]\{([^}]+)\}:\s*$")
_SIMPLE_ARRAY_RE = re.compile(r"^(\s*)(\w+)\[(\d+)\]:\s*(.+)$")
_KEY_VALUE_RE = re.compile(r"^(\s*)(\w[\w\s]*?):\s*(.+)$")
_KEY_ONLY_RE = re.compile(r"^(\s*)(\w[\w\s]*?):\s*$")


def _parse_block(lines: list[str], start: int, base_indent: int) -> tuple[Any, int]:
    """Parse a TOON block starting at the given line index."""
    result: dict = {}
    i = start

    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue

        current_indent = _get_indent(line)
        if current_indent < base_indent and i > start:
            break

        # Tabular array: key[N]{fields}:
        m = _TABULAR_RE.match(line)
        if m:
            key = m.group(2)
            count = int(m.group(3))
            fields = [f.strip() for f in m.group(4).split(",")]
            items = []
            for j in range(count):
                if i + 1 + j >= len(lines):
                    break
                row_line = lines[i + 1 + j].strip()
                vals = _split_csv_line(row_line)
                row = {}
                for fi, field in enumerate(fields):
                    row[field] = _parse_primitive(vals[fi]) if fi < len(vals) else None
                items.append(row)
            result[key] = items
            i += 1 + count
            continue

        # Simple inline array: key[N]: val1,val2,...
        m = _SIMPLE_ARRAY_RE.match(line)
        if m:
            key = m.group(2)
            vals_str = m.group(4)
            vals = _split_csv_line(vals_str)
            result[key] = [_parse_primitive(v) for v in vals]
            i += 1
            continue

        # Key with nested block: key:
        m = _KEY_ONLY_RE.match(line)
        if m:
            key = m.group(2).strip()
            nested, i = _parse_block(lines, i + 1, current_indent + 1)
            result[key] = nested
            continue

        # Key: value (inline)
        m = _KEY_VALUE_RE.match(line)
        if m:
            key = m.group(2).strip()
            val = m.group(3).strip()
            result[key] = _parse_primitive(val)
            i += 1
            continue

        i += 1

    return result, i


def _split_csv_line(line: str) -> list[str]:
    """Split a CSV line respecting quoted strings."""
    result = []
    current = []
    in_quote = False

    for ch in line:
        if ch == '"' and not in_quote:
            in_quote = True
            current.append(ch)
        elif ch == '"' and in_quote:
            in_quote = False
            current.append(ch)
        elif ch == "," and not in_quote:
            result.append("".join(current).strip())
            current = []
        else:
            current.append(ch)

    if current:
        result.append("".join(current).strip())

    return result
