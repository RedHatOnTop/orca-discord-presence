"""Sum each agent harness's token usage between two epoch seconds.

Local:  python3 tokens.py START END
Remote: ssh HOST python3 - START END < tokens.py

Standard library only; the same file runs on every host. Prints one JSON
object. A token is anything the model processed: input including cached
reads, cache writes, and output, the same measure as Codex total_tokens.
"""

import json
import re
import sqlite3
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
def varint(buf, pos):
    shift = result = 0
    while True:
        byte = buf[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, pos
        shift += 7


def proto_fields(buf):
    """Top-level protobuf fields as {number: [values]}; nested messages stay bytes."""
    out = {}
    pos = 0
    while pos < len(buf):
        key, pos = varint(buf, pos)
        wire = key & 7
        if wire == 0:
            value, pos = varint(buf, pos)
        elif wire == 1:
            value, pos = buf[pos:pos + 8], pos + 8
        elif wire == 2:
            size, pos = varint(buf, pos)
            value, pos = buf[pos:pos + size], pos + size
        elif wire == 5:
            value, pos = buf[pos:pos + 4], pos + 4
        else:
            raise ValueError(f"unsupported wire type {wire}")
        out.setdefault(key >> 3, []).append(value)
    return out


def changed_today(path):
    """A WAL database can take new rows while the main file keeps its old mtime."""
    wal = path.with_name(path.name + "-wal")
    try:
        latest = max(path.stat().st_mtime, wal.stat().st_mtime if wal.exists() else 0)
    except OSError:
        return False
    return latest >= START


def query(path, sql, params=()):
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            return con.execute(sql, params).fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return []


# Antigravity keeps one SQLite file per conversation, written through a WAL.
# steps.metadata: 1 = {1: start epoch seconds}, 9 = usage {2: uncached input,
# 5: cached read, 4: cache write, 3: output incl. thinking, 11: response id}.
AGY_FIELDS = (2, 5, 4, 3)


def antigravity(tally):
    for root in (HOME / ".gemini" / "antigravity-cli" / "conversations", HOME / ".gemini" / "antigravity" / "conversations"):
        if not root.is_dir():
            continue
        for path in root.glob("*.db"):
            if not changed_today(path):
                continue
            rows = query(path, "select metadata from steps where metadata is not null")
            for (meta,) in rows:
                try:
                    top = proto_fields(meta)
                    if 9 not in top or 1 not in top:
                        continue
                    usage = proto_fields(top[9][0])
                    started = proto_fields(top[1][0])[1][0]
                except (ValueError, IndexError, KeyError, TypeError):
                    continue
                if not in_window(float(started)):
                    continue
                response = usage.get(11, [None])[0]
                tokens = sum(usage.get(f, [0])[0] for f in AGY_FIELDS)
                tally.add(tokens, bytes(response) if response else None)


# OpenCode and its MiMo fork store each assistant request as one message row,
# updated in place; tokens.total already includes reasoning and cache.
OPENCODE_SQL = (
    "select id, json_extract(data, '$.tokens.total') from message"
    " where time_created >= ? and time_created < ? and json_extract(data, '$.role') = 'assistant'"
)


def opencode_family(tally, databases):
    window = (int(START * 1000), int(END * 1000))
    for path in databases:
        if not path.is_file() or not changed_today(path):
            continue
        sql = OPENCODE_SQL
        if query(path, "select 1 from sqlite_master where type = 'table' and name = 'external_import'"):
            # MiMo imports Claude Code transcripts; those are counted under Claude.
            sql += " and session_id not in (select session_id from external_import)"
        for message_id, total in query(path, sql, window):
            if isinstance(total, (int, float)):
                tally.add(total, message_id)


def opencode(tally):
    opencode_family(tally, [HOME / ".local" / "share" / "opencode" / "opencode.db"])


def mimo(tally):
    opencode_family(tally, [
        HOME / ".config" / "orca" / "mimocode-hooks" / "shared" / "data" / "mimocode.db",
        HOME / ".local" / "share" / "mimocode" / "mimocode.db",
    ])


KIMI_FIELDS = ("inputOther", "inputCacheRead", "inputCacheCreation", "output")


def kimi(tally):
    for path in touched(HOME / ".kimi-code" / "sessions", "wire.jsonl"):
        for row in json_lines(path, '"usage.record"'):
            if row.get("type") != "usage.record" or not in_window(epoch(row.get("time"))):
                continue
            usage = row.get("usage") or {}
            tally.add(sum(num(usage.get(f)) for f in KIMI_FIELDS))


def cline(tally):
    # A resumed session copies earlier messages verbatim, so ids dedupe them.
    for path in touched(HOME / ".cline" / "data" / "sessions", "*.messages.json"):
        data = json_file(path)
        messages = data.get("messages") if isinstance(data, dict) else data
        for message in messages if isinstance(messages, list) else []:
            if not isinstance(message, dict):
                continue
            metrics = message.get("metrics")
            if not isinstance(metrics, dict) or not in_window(epoch(message.get("ts"))):
                continue
            tokens = num(metrics.get("inputTokens")) + num(metrics.get("cacheWriteTokens")) + num(metrics.get("outputTokens"))
            tally.add(tokens, message.get("id"))


HARNESSES = [
    ("claude", "Claude", claude, False),
    ("codex", "Codex", codex, True),
    ("grok", "Grok", grok, False),
    ("antigravity", "Antigravity", antigravity, False),
    ("opencode", "OpenCode", opencode, False),
    ("mimo", "MiMo", mimo, False),
    ("kimi", "Kimi", kimi, False),
    ("cline", "Cline", cline, False),
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
