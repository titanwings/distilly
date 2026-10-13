"""Collect bounded public X post candidates for celebrity research."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit

API_URL = "https://xquik.com/api/v1/x/tweets/search"
API_CONTRACT = "2026-04-29"
API_KEY_ENV = "XQUIK_API_KEY"
DEFAULT_LIMIT = 20
MAX_LIMIT = 100
MAX_QUERY_CHARS = 512
MAX_CONTENT_CHARS = 500
REQUEST_TIMEOUT_SECONDS = 30
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_]{1,15}$")
STATUS_PATH_PATTERN = re.compile(r"^/([A-Za-z0-9_]{1,15})/status/(\d+)/?$")
LANGUAGE_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9-]{0,15}$")
QUERY_TYPES = {"Latest", "Top"}


class CollectorError(Exception):
    """Describe a public-post collection failure without exposing secrets."""


def default_get(url: str, **kwargs: object) -> Any:
    """Load the existing HTTP dependency only when a request is made."""
    try:
        import requests
    except ImportError as error:
        raise CollectorError("Missing requests. Run pip install -r requirements.txt.") from error

    try:
        return requests.get(url, **kwargs)
    except requests.RequestException as error:
        raise CollectorError("Could not reach Xquik. Check the connection and retry.") from error


def build_query(query: Optional[str], username: Optional[str]) -> str:
    """Return one validated public-post query."""
    if username:
        candidate = username.removeprefix("@").strip()
        if not USERNAME_PATTERN.fullmatch(candidate):
            raise CollectorError("Invalid X username. Use 1-15 letters, digits, or underscores.")
        return f"from:{candidate}"

    normalized = " ".join((query or "").split())
    if not normalized:
        raise CollectorError("Missing query. Pass --query or --username.")
    if any(ord(character) < 32 or ord(character) == 127 for character in normalized):
        raise CollectorError("Query contains unsupported control characters.")
    if len(normalized) > MAX_QUERY_CHARS:
        raise CollectorError(f"Query exceeds {MAX_QUERY_CHARS} characters.")
    return normalized


def validate_limit(limit: int) -> int:
    """Reject unbounded or empty collections."""
    if not 1 <= limit <= MAX_LIMIT:
        raise CollectorError(f"Limit must be between 1 and {MAX_LIMIT}.")
    return limit


def clean_text(value: object, max_chars: int) -> str:
    """Remove terminal controls and cap one untrusted text value."""
    if not isinstance(value, str):
        return ""
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value).strip()
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[: max_chars - 3].rstrip() + "..."


def canonical_post_url(tweet: dict[str, Any]) -> Optional[str]:
    """Return an HTTPS X permalink for a post with a valid numeric ID."""
    tweet_id = str(tweet.get("id") or "")
    if not tweet_id.isdigit():
        return None

    author = tweet.get("author")
    username = author.get("username") if isinstance(author, dict) else None
    if isinstance(username, str) and USERNAME_PATTERN.fullmatch(username):
        return f"https://x.com/{username}/status/{tweet_id}"

    raw_url = tweet.get("url")
    if not isinstance(raw_url, str):
        return None
    parsed = urlsplit(raw_url)
    host = (parsed.hostname or "").lower().removeprefix("www.").removeprefix("mobile.")
    match = STATUS_PATH_PATTERN.fullmatch(parsed.path)
    if parsed.scheme != "https" or host not in {"x.com", "twitter.com"} or not match:
        return None
    if match.group(2) != tweet_id:
        return None
    return f"https://x.com/{match.group(1)}/status/{tweet_id}"


def safe_count(value: object) -> Optional[int]:
    """Keep non-negative integer metrics and discard malformed values."""
    return (
        value
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0
        else None
    )


def normalize_timestamp(value: object) -> Optional[str]:
    """Return a safe ISO timestamp from legacy or normalized API values."""
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        try:
            return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z")
        except (OSError, OverflowError, ValueError):
            return None
    cleaned = clean_text(value, 64)
    return cleaned or None


def normalize_post(tweet: object) -> Optional[dict[str, Any]]:
    """Convert one API result into the collector's untrusted message shape."""
    if not isinstance(tweet, dict):
        return None

    tweet_id = str(tweet.get("id") or "")
    text = tweet.get("text")
    url = canonical_post_url(tweet)
    if not tweet_id.isdigit() or not isinstance(text, str) or not text.strip() or url is None:
        return None

    sanitized_text = re.sub(
        r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]",
        "",
        text,
    ).strip()
    if not sanitized_text:
        return None
    truncated = len(sanitized_text) > MAX_CONTENT_CHARS
    text = clean_text(sanitized_text, MAX_CONTENT_CHARS)

    author = tweet.get("author") if isinstance(tweet.get("author"), dict) else {}
    username = author.get("username")
    path_match = STATUS_PATH_PATTERN.fullmatch(urlsplit(url).path)
    normalized_username = (
        username
        if isinstance(username, str) and USERNAME_PATTERN.fullmatch(username)
        else path_match.group(1) if path_match else ""
    )
    verified = author.get("verified")
    normalized_author = {
        "id": str(author.get("id") or ""),
        "name": clean_text(author.get("name"), 100),
        "username": normalized_username,
        "verified": verified if isinstance(verified, bool) else False,
    }
    metrics = {
        "bookmarks": safe_count(tweet.get("bookmark_count", tweet.get("bookmarkCount"))),
        "likes": safe_count(tweet.get("like_count", tweet.get("likeCount"))),
        "quotes": safe_count(tweet.get("quote_count", tweet.get("quoteCount"))),
        "replies": safe_count(tweet.get("reply_count", tweet.get("replyCount"))),
        "reposts": safe_count(tweet.get("retweet_count", tweet.get("retweetCount"))),
        "views": safe_count(tweet.get("view_count", tweet.get("viewCount"))),
    }

    created = tweet.get("created", tweet.get("created_at", tweet.get("createdAt")))
    language = tweet.get("lang")
    return {
        "id": tweet_id,
        "content": text,
        "content_truncated": truncated,
        "published_at": normalize_timestamp(created),
        "url": url,
        "language": language if isinstance(language, str) and LANGUAGE_PATTERN.fullmatch(language) else None,
        "author": normalized_author,
        "metrics": {key: value for key, value in metrics.items() if value is not None},
        "trust": "untrusted_candidate_evidence",
    }


def request_posts(
    api_key: str,
    query: str,
    limit: int,
    query_type: str,
    request_get: Callable[..., Any] = default_get,
) -> dict[str, Any]:
    """Make one read-only Xquik search request and return its JSON object."""
    if query_type not in QUERY_TYPES:
        raise CollectorError("Sort must be Latest or Top.")
    response = request_get(
        API_URL,
        headers={
            "accept": "application/json",
            "x-api-key": api_key,
            "xquik-api-contract": API_CONTRACT,
        },
        params={"limit": limit, "q": query, "queryType": query_type},
        timeout=REQUEST_TIMEOUT_SECONDS,
        allow_redirects=False,
    )

    status = getattr(response, "status_code", 500)
    if 300 <= status < 400:
        raise CollectorError("Xquik redirected the request. Refusing to forward the API key.")
    if status >= 400:
        messages = {
            400: "Xquik rejected the search query. Check it and retry.",
            401: "Authentication failed. Set XQUIK_API_KEY to a valid Xquik API key.",
            402: "Insufficient Xquik credits. Add credits or lower the limit.",
            403: "Xquik denied the request. Check API key permissions.",
            422: "Xquik rejected the search query. Check it and retry.",
            424: "The X data source is unavailable. Retry later.",
            429: "Xquik rate limit reached. Retry later.",
        }
        message = messages.get(status)
        if message is None and status >= 500:
            message = "Xquik is unavailable. Retry later."
        raise CollectorError(message or f"Xquik request failed with HTTP {status}.")

    try:
        payload = response.json()
    except (TypeError, ValueError) as error:
        raise CollectorError("Xquik returned invalid JSON. Retry later.") from error
    if not isinstance(payload, dict):
        raise CollectorError("Xquik returned an unexpected response shape.")
    return payload


def collect_public_posts(
    *,
    api_key: str,
    query: str,
    limit: int,
    query_type: str,
    subject: Optional[str] = None,
    request_get: Callable[..., Any] = default_get,
    collected_at: Optional[str] = None,
) -> dict[str, Any]:
    """Return normalized, de-duplicated candidate evidence from one page."""
    if not api_key.strip():
        raise CollectorError("Missing XQUIK_API_KEY. Set it in the shell and retry.")

    normalized_query = build_query(query, None)
    payload = request_posts(
        api_key.strip(),
        normalized_query,
        validate_limit(limit),
        query_type,
        request_get,
    )
    raw_tweets = payload.get("tweets")
    if raw_tweets is None and isinstance(payload.get("data"), dict):
        raw_tweets = payload["data"].get("tweets")
    if not isinstance(raw_tweets, list):
        raise CollectorError("Xquik response is missing the tweets list.")

    messages = []
    seen_ids = set()
    for raw_tweet in raw_tweets:
        message = normalize_post(raw_tweet)
        if message is None or message["id"] in seen_ids:
            continue
        seen_ids.add(message["id"])
        messages.append(message)
        if len(messages) == limit:
            break

    subjects = []
    normalized_subject = clean_text(subject, 100)
    if normalized_subject:
        subjects.append(normalized_subject)
    for message in messages:
        username = message["author"]["username"]
        if username and username not in subjects:
            subjects.append(username)

    timestamp = normalize_timestamp(collected_at) or (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )
    has_more = bool(payload.get("has_more", payload.get("has_next_page", False)))
    return {
        "source_type": "x_public_posts",
        "subject_candidates": subjects,
        "documents": [],
        "messages": messages,
        "attachments": [],
        "metadata": {
            "collected_at": timestamp,
            "collector": "xquik_public_posts",
            "endpoint": "/api/v1/x/tweets/search",
            "query": normalized_query,
            "query_type": query_type,
            "requested_limit": limit,
            "returned_count": len(messages),
            "has_more": has_more,
            "pagination_followed": False,
            "content_policy": (
                "Review every candidate. Verify its author and open its permalink "
                "before safely paraphrasing it."
            ),
            "provider": "Xquik",
        },
    }


def write_collection(path: Path, collection: dict[str, Any], force: bool) -> None:
    """Write UTF-8 JSON without overwriting an existing collection by default."""
    contents = json.dumps(collection, ensure_ascii=False, indent=2) + "\n"
    temporary_path: Optional[Path] = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.is_symlink():
            raise CollectorError(f"Refusing to write through symbolic link: {path}.")
        if not force:
            with path.open("x", encoding="utf-8") as output:
                output.write(contents)
            return

        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as output:
            temporary_path = Path(output.name)
            output.write(contents)
        os.replace(temporary_path, path)
        temporary_path = None
    except CollectorError:
        raise
    except FileExistsError as error:
        raise CollectorError(
            f"Output already exists: {path}. Pass --force to replace it."
        ) from error
    except OSError as error:
        raise CollectorError(f"Could not write output: {path}.") from error
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink()
            except OSError:
                pass


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Collect bounded public X post candidates through Xquik.",
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument(
        "--query",
        help="Public X search query, including supported operators.",
    )
    source.add_argument("--username", help="Public X username, with or without @.")
    parser.add_argument("--subject", help="Person label to preserve in collector metadata.")
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help=f"Result limit, 1-{MAX_LIMIT}.",
    )
    parser.add_argument("--sort", choices=("latest", "top"), default="latest")
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Destination JSON file.",
    )
    parser.add_argument("--force", action="store_true", help="Replace an existing output file.")
    args = parser.parse_args()

    try:
        query = build_query(args.query, args.username)
        collection = collect_public_posts(
            api_key=os.environ.get(API_KEY_ENV, ""),
            query=query,
            limit=args.limit,
            query_type=args.sort.title(),
            subject=args.subject,
        )
        write_collection(args.output.expanduser(), collection, args.force)
    except CollectorError as error:
        print(f"Collection failed. {error}", file=sys.stderr)
        raise SystemExit(1) from error

    print(
        f"Collected {collection['metadata']['returned_count']} public post candidates: "
        f"{args.output}"
    )
