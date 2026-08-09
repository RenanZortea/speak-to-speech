"""
Session persistence — SQLite, stdlib only.

A "session" is a saved transcription (+ its corrections) with its audio copied
into app storage so it survives the user moving/deleting the original.

Layout:
    ~/SpeakToSpeech/sessions.db                 — metadata + segments/corrections JSON
    ~/SpeakToSpeech/sessions/<id>/audio.<ext>   — copied audio per session

Segments and corrections are stored as JSON blobs (denormalized). We never query
inside them; loading a session reads the whole row. Normalize later only if
cross-session queries are ever needed.

`pronunciation_json` is a dead column: the pronunciation feature was removed, but
the column stays (SQLite makes DROP COLUMN awkward and old rows are harmless).
Nothing reads or writes it.
"""
import json
import shutil
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

DEFAULT_BASE = Path.home() / "SpeakToSpeech"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SessionStore:
    def __init__(self, base_dir: Path = DEFAULT_BASE):
        self._base = Path(base_dir)
        self._db_path = self._base / "sessions.db"
        self._sessions_dir = self._base / "sessions"
        self._lock = threading.Lock()
        self._base.mkdir(parents=True, exist_ok=True)
        self._sessions_dir.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self):
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id                  TEXT PRIMARY KEY,
                    title               TEXT NOT NULL,
                    created_at          TEXT NOT NULL,
                    updated_at          TEXT NOT NULL,
                    audio_stored_path   TEXT,
                    original_audio_path TEXT,
                    language            TEXT,
                    model_id            TEXT,
                    duration            REAL,
                    segments_json       TEXT NOT NULL,
                    pronunciation_json  TEXT,
                    corrections_json    TEXT
                )
                """
            )
            # Migrate older DBs that predate the corrections column.
            cols = [r[1] for r in conn.execute("PRAGMA table_info(sessions)").fetchall()]
            if "corrections_json" not in cols:
                conn.execute("ALTER TABLE sessions ADD COLUMN corrections_json TEXT")

    # ---- public API ----

    def save_session(self, data: dict) -> dict:
        """Create a new saved session. `data` keys:
        title, audio_path, language, model_id, duration, segments, corrections."""
        sid = uuid.uuid4().hex[:12]
        now = _now()

        # Copy audio into app storage so the session is self-contained.
        stored_path = None
        src = data.get("audio_path")
        if src and Path(src).is_file():
            sess_dir = self._sessions_dir / sid
            sess_dir.mkdir(parents=True, exist_ok=True)
            ext = Path(src).suffix or ".audio"
            dest = sess_dir / f"audio{ext}"
            try:
                shutil.copy2(src, dest)
                stored_path = str(dest)
            except Exception:
                stored_path = None

        title = (data.get("title") or "").strip() or f"Session {now[:10]}"
        segments_json = json.dumps(data.get("segments") or [], ensure_ascii=False)
        corr = data.get("corrections")
        corr_json = json.dumps(corr, ensure_ascii=False) if corr else None

        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO sessions
                  (id, title, created_at, updated_at, audio_stored_path,
                   original_audio_path, language, model_id, duration,
                   segments_json, corrections_json)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    sid, title, now, now, stored_path, src,
                    data.get("language"), data.get("model_id"),
                    data.get("duration"), segments_json, corr_json,
                ),
            )
        return self._summary_row({
            "id": sid, "title": title, "created_at": now, "updated_at": now,
            "duration": data.get("duration"),
        })

    def update_session(self, sid: str, data: dict) -> Optional[dict]:
        """Overwrite segments/corrections/title of an existing session."""
        now = _now()
        segments_json = json.dumps(data.get("segments") or [], ensure_ascii=False)
        corr = data.get("corrections")
        corr_json = json.dumps(corr, ensure_ascii=False) if corr else None
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                """
                UPDATE sessions
                   SET title = COALESCE(?, title),
                       updated_at = ?,
                       segments_json = ?,
                       corrections_json = ?,
                       duration = COALESCE(?, duration)
                 WHERE id = ?
                """,
                (data.get("title"), now, segments_json, corr_json,
                 data.get("duration"), sid),
            )
            if cur.rowcount == 0:
                return None
        return self.load_session(sid)

    def list_sessions(self) -> list[dict]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """SELECT id, title, created_at, updated_at, duration
                   FROM sessions ORDER BY updated_at DESC"""
            ).fetchall()
        return [self._summary_row(dict(r)) for r in rows]

    def load_session(self, sid: str) -> Optional[dict]:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT * FROM sessions WHERE id = ?", (sid,)).fetchone()
        if row is None:
            return None
        r = dict(row)
        return {
            "id": r["id"],
            "title": r["title"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
            "audio_stored_path": r["audio_stored_path"],
            "language": r["language"],
            "model_id": r["model_id"],
            "duration": r["duration"],
            "segments": json.loads(r["segments_json"]) if r["segments_json"] else [],
            "corrections": json.loads(r["corrections_json"]) if r.get("corrections_json") else [],
        }

    def rename_session(self, sid: str, title: str) -> bool:
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
                (title.strip() or "Untitled", _now(), sid),
            )
            return cur.rowcount > 0

    def delete_session(self, sid: str) -> bool:
        with self._lock, self._connect() as conn:
            cur = conn.execute("DELETE FROM sessions WHERE id = ?", (sid,))
            deleted = cur.rowcount > 0
        # Remove the per-session audio folder.
        sess_dir = self._sessions_dir / sid
        if sess_dir.exists():
            shutil.rmtree(sess_dir, ignore_errors=True)
        return deleted

    # ---- helpers ----

    @staticmethod
    def _summary_row(r: dict) -> dict:
        return {
            "id": r["id"],
            "title": r["title"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
            "duration": r.get("duration"),
        }
