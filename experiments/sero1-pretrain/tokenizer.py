"""Locked, lossless Sero 1 byte-BPE wrapper."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Sequence

from tokenizers import Tokenizer


def byte_unicode_tables() -> tuple[dict[int, str], dict[str, int]]:
    visible = list(range(ord("!"), ord("~") + 1))
    visible += list(range(ord("¡"), ord("¬") + 1))
    visible += list(range(ord("®"), ord("ÿ") + 1))
    codepoints = list(visible)
    extra = 0
    for byte in range(256):
        if byte not in visible:
            visible.append(byte)
            codepoints.append(256 + extra)
            extra += 1
    encode = {byte: chr(codepoint) for byte, codepoint in zip(visible, codepoints)}
    return encode, {character: byte for byte, character in encode.items()}


BYTE_TO_CHAR, CHAR_TO_BYTE = byte_unicode_tables()


def bytes_to_alphabet(data: bytes) -> str:
    return "".join(BYTE_TO_CHAR[value] for value in data)


def alphabet_to_bytes(text: str) -> bytes:
    try:
        return bytes(CHAR_TO_BYTE[character] for character in text)
    except KeyError as error:
        raise ValueError(f"token contains a character outside the byte alphabet: {error}") from error


class Sero1Tokenizer:
    def __init__(self, path: Path, maximum_token_bytes: int = 8) -> None:
        self.path = path.resolve()
        raw = self.path.read_bytes()
        self.artifact_sha256 = hashlib.sha256(raw).hexdigest()
        self.tokenizer = Tokenizer.from_file(str(self.path))
        self.vocab_size = self.tokenizer.get_vocab_size()
        self.maximum_token_bytes = maximum_token_bytes
        self._token_bytes = [
            alphabet_to_bytes(self.tokenizer.id_to_token(token_id))
            for token_id in range(self.vocab_size)
        ]
        if any(not token for token in self._token_bytes):
            raise ValueError("tokenizer contains an empty token")
        if max(map(len, self._token_bytes)) > maximum_token_bytes:
            raise ValueError("tokenizer contains a token above the frozen byte limit")
        single_bytes = {token[0] for token in self._token_bytes if len(token) == 1}
        if single_bytes != set(range(256)):
            raise ValueError("tokenizer does not contain the complete byte alphabet")

    def encode(self, data: bytes) -> tuple[list[int], list[int]]:
        if not data:
            return [], []
        encoded = self.tokenizer.encode(bytes_to_alphabet(data), add_special_tokens=False)
        ids = encoded.ids
        lengths = [len(self._token_bytes[token_id]) for token_id in ids]
        if self.decode(ids) != data:
            raise RuntimeError("Sero 1 tokenizer round-trip failed")
        return ids, lengths

    def decode(self, token_ids: Sequence[int]) -> bytes:
        return b"".join(self._token_bytes[token_id] for token_id in token_ids)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()
