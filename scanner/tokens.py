"""Sum each agent harness's token usage between two epoch seconds.

Local:  python3 tokens.py START END
Remote: ssh HOST python3 - START END < tokens.py

Standard library only; the same file runs on every host. Prints one JSON
object. A token is anything the model processed: input including cached
reads, cache writes, and output, the same measure as Codex total_tokens.
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

START = float(sys.argv[1])
END = float(sys.argv[2])
HOME = Path.home()

FRACTION = re.compile(r"(\.\d{6})\d+")


def epoch(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value / 1000 if value > 1e11 else float(value)
    if not isinstance(value, str) or not value:
        return None
    text = FRACTION.sub(r"\1", value.strip().replace("Z", "+00:00"))
    try:
        stamp = datetime.fromisoformat(text)
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.astimezone()
    return stamp.timestamp()


def in_window(ts):
    return ts is not None and START <= ts < END


def touched(root, pattern):
    if not root.is_dir():
        return
    for path in root.rglob(pattern):
        try:
            if path.is_file() and path.stat().st_mtime >= START:
                yield path
        except OSError:
            continue


def json_lines(path, needle):
    try:
        handle = path.open(encoding="utf-8", errors="ignore")
    except OSError:
        return
    with handle:
        for line in handle:
            if needle not in line:
                continue
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if isinstance(row, dict):
                yield row


def json_file(path):
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="ignore"))
    except (OSError, ValueError):
        return None


def num(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


class Tally:
    """Keyed records keep their largest value: a streamed response is logged
    again as its output grows."""

    def __init__(self):
        self.loose = 0
        self.loose_records = 0
        self.keyed = {}

    def add(self, tokens, key=None):
        if key is None:
            self.loose += tokens
            self.loose_records += 1
        elif tokens > self.keyed.get(key, -1):
            self.keyed[key] = tokens

    @property
    def tokens(self):
        return self.loose + sum(self.keyed.values())

    @property
    def records(self):
        return self.loose_records + len(self.keyed)


CLAUDE_FIELDS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")


def claude(tally):
    # One response is written once per content block, and resumed or forked
    # sessions copy earlier responses into the new file.
    for path in touched(HOME / ".claude" / "projects", "*.jsonl"):
        for row in json_lines(path, '"usage"'):
            if row.get("type") != "assistant":
                continue
            message = row.get("message") or {}
            usage = message.get("usage") or {}
            if not usage or not in_window(epoch(row.get("timestamp"))):
                continue
            ids = (message.get("id"), row.get("requestId"))
            tally.add(sum(num(usage.get(f)) for f in CLAUDE_FIELDS), ids if any(ids) else None)


def codex(tally):
    # codex-handoff copies rollouts between hosts, so records are keyed for a
    # cross-host union. Older rollouts only carry cumulative token_count events.
    for path in touched(HOME / ".codex" / "sessions", "*.jsonl"):
        per_request = []
        cumulative = []
        session = path.stem
        for row in json_lines(path, "token_"):
            kind = row.get("type")
            payload = row.get("payload") or {}
            if kind == "token_usage_record":
                per_request.append((row.get("timestamp"), payload))
            elif kind == "event_msg" and payload.get("type") == "token_count":
                total = ((payload.get("info") or {}).get("total_token_usage") or {}).get("total_tokens")
                if isinstance(total, (int, float)):
                    cumulative.append((row.get("timestamp"), total))
        if per_request:
            for stamp, payload in per_request:
                if not in_window(epoch(stamp)):
                    continue
                tokens = num((payload.get("usage") or {}).get("total_tokens"))
                key = payload.get("response_id") or f"{session}@{stamp}"
                tally.add(tokens, f"codex:{key}")
            continue
        previous = 0
        for stamp, total in cumulative:
            delta = total - previous
            previous = max(previous, total)
            if delta > 0 and in_window(epoch(stamp)):
                tally.add(delta, f"codex:{session}@{stamp}")


def grok(tally):
    for path in touched(HOME / ".grok" / "sessions", "usage.json"):
        data = json_file(path)
        if not isinstance(data, dict):
            continue
        for turn in data.get("turns") or []:
            if isinstance(turn, dict) and in_window(epoch(turn.get("endedAt"))):
                tally.add(num(turn.get("totalTokens")))


# (id, label, scan, shared): shared ledgers can hold the same record on
# several hosts, so their keys go out for a cross-host union.
HARNESSES = [
    ("claude", "Claude", claude, False),
    ("codex", "Codex", codex, True),
    ("grok", "Grok", grok, False),
]


def main():
    totals = []
    errors = []
    for harness, label, scan, shared in HARNESSES:
        tally = Tally()
        try:
            scan(tally)
        except Exception as err:  # one broken ledger must not blank the others
            errors.append({"harness": harness, "error": f"{type(err).__name__}: {err}"})
            continue
        if tally.records == 0:
            continue
        row = {"harness": harness, "label": label, "tokens": tally.tokens, "records": tally.records}
        if shared:
            row["keyed"] = tally.keyed
        totals.append(row)
    print(json.dumps({"totals": totals, "errors": errors}, separators=(",", ":")))


main()
