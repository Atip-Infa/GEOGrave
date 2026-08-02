-- Migration 003: add reporter_phone to reports table
-- Thai phone numbers: 0XX-XXX-XXXX (mobile) or 0X-XXXX-XXXX (landline)
-- Stored as text to preserve leading zeros and allow dashes.
-- Optional — existing rows get NULL.

ALTER TABLE reports ADD COLUMN reporter_phone TEXT;
