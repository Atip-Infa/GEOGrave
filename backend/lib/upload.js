const multer = require('multer');
const path = require('path');
const { randomUUID } = require('crypto');

// Whitelist of allowed attachment types (evidence photos / scanned docs).
// The original app trusted the client-supplied extension/mimetype blindly,
// which would let anyone upload a .html or .php or .exe disguised as an
// attachment into a publicly-served /uploads folder.
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf']);

function buildUpload(uploadDir) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      // Always generate the on-disk name ourselves (never trust
      // file.originalname for the path) to prevent path traversal /
      // overwrite attacks, while keeping a safe, whitelisted extension.
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ALLOWED_EXT.has(ext) ? ext : '';
      cb(null, `${randomUUID()}${safeExt}`);
    }
  });

  return multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024, files: 5 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_MIME.has(file.mimetype) || !ALLOWED_EXT.has(ext)) {
        return cb(new Error('Unsupported file type. Allowed: JPG, PNG, WEBP, GIF, PDF'));
      }
      cb(null, true);
    }
  });
}

module.exports = { buildUpload, ALLOWED_MIME, ALLOWED_EXT };
