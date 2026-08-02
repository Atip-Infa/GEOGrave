const fs = require('fs');
const { body, param, validationResult } = require('express-validator');

// Global coordinate bounds (not actually Thailand-specific - see the
// explicit null-island check below for the one geographically-meaningful
// rejection this module performs).
const LAT_MIN = -90, LAT_MAX = 90, LNG_MIN = -180, LNG_MAX = 180;

// FIX: this file used to *claim* (in a comment) that it rejected "(0,0)
// null island", but the actual bounds check never did - (0,0) is well
// within -90..90/-180..180 and sailed through validation. This is the
// real implementation: reject the specific case where both lat AND lng
// are exactly 0, which is never a legitimate report location for this
// app and is the classic signature of a missing/dropped coordinate (e.g.
// a form field that silently defaulted to 0 instead of failing).
function notNullIsland(req) {
  const lat = parseFloat(req.body.lat);
  const lng = parseFloat(req.body.lng);
  if (lat === 0 && lng === 0) {
    throw new Error('lat/lng of exactly (0,0) is not a valid report location');
  }
  return true;
}

const createPointRules = [
  body('lat')
    .notEmpty().withMessage('lat is required')
    .bail()
    .isFloat({ min: LAT_MIN, max: LAT_MAX }).withMessage('lat must be a number between -90 and 90'),
  body('lng')
    .notEmpty().withMessage('lng is required')
    .bail()
    .isFloat({ min: LNG_MIN, max: LNG_MAX }).withMessage('lng must be a number between -180 and 180')
    .bail()
    .custom((_, { req }) => notNullIsland(req)),
  body('victimName')
    .trim().notEmpty().withMessage('victimName is required')
    .isLength({ max: 200 }).withMessage('victimName is too long'),
  body('victimAge')
    .optional({ checkFalsy: true })
    .isInt({ min: 0, max: 150 }).withMessage('victimAge must be a realistic number'),
  body('victimGender').optional({ checkFalsy: true }).isLength({ max: 50 }),
  body('causeOfDeath').optional({ checkFalsy: true }).isLength({ max: 500 }),
  body('reportedDate').optional({ checkFalsy: true }).isISO8601().withMessage('reportedDate must be a valid date'),
  body('reportedTime').optional({ checkFalsy: true }).matches(/^([01]\d|2[0-3]):([0-5]\d)$/).withMessage('reportedTime must be HH:MM'),
  body('locationOfDeath').optional({ checkFalsy: true }).isLength({ max: 300 }),
  body('destinationTemple').optional({ checkFalsy: true }).isLength({ max: 300 }),
  body('reportedBy').optional({ checkFalsy: true }).isLength({ max: 200 }),
  body('reporterPhone').optional({ checkFalsy: true })
    .matches(/^[0-9\-+ ()]{7,20}$/).withMessage('reporterPhone must be a valid phone number'),
  body('reporterIdCard').optional({ checkFalsy: true }).matches(/^\d{13}$/).withMessage('reporterIdCard must be 13 digits'),
];

// For PUT, every field is optional (partial update), but validated when
// present. (The previous file also defined a dead `updatePointRules` const
// here - `createPointRules.map(rule => rule.optional ? rule : rule)` - a
// no-op that returned every rule completely unchanged despite its name
// implying it relaxed them. It was never imported anywhere; removed.)
const updateRules = [
  param('id').isUUID().withMessage('invalid id'),
  body('lat').optional().isFloat({ min: LAT_MIN, max: LAT_MAX }),
  body('lng').optional().isFloat({ min: LNG_MIN, max: LNG_MAX })
    .bail()
    .custom((_, { req }) => {
      // Only meaningful when both coordinates are actually being set in
      // this request - a partial update touching an unrelated field
      // shouldn't be rejected because of coordinates it isn't changing.
      if (req.body.lat === undefined || req.body.lng === undefined) return true;
      return notNullIsland(req);
    }),
  body('victimName').optional().trim().isLength({ max: 200 }),
  body('victimAge').optional({ checkFalsy: true }).isInt({ min: 0, max: 150 }),
  body('victimGender').optional({ checkFalsy: true }).isLength({ max: 50 }),
  body('causeOfDeath').optional({ checkFalsy: true }).isLength({ max: 500 }),
  body('reportedDate').optional({ checkFalsy: true }).isISO8601(),
  body('reportedTime').optional({ checkFalsy: true }).matches(/^([01]\d|2[0-3]):([0-5]\d)$/),
  body('locationOfDeath').optional({ checkFalsy: true }).isLength({ max: 300 }),
  body('destinationTemple').optional({ checkFalsy: true }).isLength({ max: 300 }),
  body('reportedBy').optional({ checkFalsy: true }).isLength({ max: 200 }),
  body('reporterPhone').optional({ checkFalsy: true })
    .matches(/^[0-9\-+ ()]{7,20}$/).withMessage('reporterPhone must be a valid phone number'),
  body('reporterIdCard').optional({ checkFalsy: true }).matches(/^\d{13}$/),
];

const idParamRule = [param('id').isUUID().withMessage('invalid id')];

// FIX (orphaned upload leak): multer's upload.array() middleware runs and
// writes files to disk BEFORE these rules execute. A request with a valid
// attached image but an invalid field elsewhere (e.g. lat=999) was
// correctly rejected with 400, but the file multer had already written
// was never cleaned up - verified empirically during audit, leaking disk
// space on every such rejection. Delete anything multer wrote for this
// request before responding.
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    (req.files || []).forEach(f => fs.unlink(f.path, () => {})); // best-effort cleanup
    return res.status(400).json({ error: 'Validation failed', details: errors.array().map(e => ({ field: e.path, message: e.msg })) });
  }
  next();
}

module.exports = { createPointRules, updateRules, idParamRule, handleValidation };
