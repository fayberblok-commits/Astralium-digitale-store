import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeFilename, ALLOWED_EXTENSIONS } from "../src/lib/uploads.ts";

test("allowlist covers the deliverable formats", () => {
  for (const ext of ["pdf", "zip", "mp3", "mp4", "epub", "mobi", "png", "jpg", "wav", "flac"]) {
    assert.ok(ALLOWED_EXTENSIONS.includes(ext), ext);
    assert.equal(sanitizeFilename(`file.${ext}`), `file.${ext}`);
  }
});

test("paths are stripped to a basename", () => {
  assert.equal(sanitizeFilename("a/b/c/book.epub"), "book.epub");
  assert.equal(sanitizeFilename("..\\..\\win\\track.mp3"), "track.mp3");
  assert.equal(sanitizeFilename("../../etc/passwd"), null); // no allowed extension
});

test("unsafe characters collapse to dashes; spaces handled", () => {
  assert.equal(sanitizeFilename("My Book (Final).PDF"), "My-Book-Final-.PDF");
});

test("disallowed extensions and dotfiles rejected", () => {
  assert.equal(sanitizeFilename("evil.exe"), null);
  assert.equal(sanitizeFilename("script.js"), null);
  assert.equal(sanitizeFilename(".pdf"), null);
  assert.equal(sanitizeFilename("noextension"), null);
  assert.equal(sanitizeFilename(""), null);
});
