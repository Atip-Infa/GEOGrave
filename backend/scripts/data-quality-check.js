#!/usr/bin/env node
// DATA QUALITY CHECK
//
// Usage: node scripts/data-quality-check.js
//
// Write-time validation (express-validator at the API layer, CHECK
// constraints at the database layer) prevents new bad data from getting
// in, but doesn't audit data that's already there - e.g. from a bulk ETL
// import, a schema that was looser in an earlier version, or a bug that's
// since been fixed but left bad rows behind. This is a read-only report,
// not a fixer: it flags what a human should look at, deliberately does
// not modify anything.

const { getDb } = require('../lib/db/connection');

function run() {
  const db = getDb();
  const findings = [];

  const missingCause = db.prepare("SELECT COUNT(*) AS c FROM reports WHERE cause_of_death IS NULL OR cause_of_death = ''").get().c;
  if (missingCause > 0) findings.push({ severity: 'info', check: 'missing_cause_of_death', count: missingCause, detail: 'Reports with no cause of death recorded.' });

  const missingLocation = db.prepare("SELECT COUNT(*) AS c FROM reports WHERE location_of_death IS NULL OR location_of_death = ''").get().c;
  if (missingLocation > 0) findings.push({ severity: 'info', check: 'missing_location', count: missingLocation, detail: 'Reports with no location_of_death recorded.' });

  const noAttachments = db.prepare(`
    SELECT COUNT(*) AS c FROM reports r
    WHERE NOT EXISTS (SELECT 1 FROM attachments a WHERE a.report_id = r.id)
  `).get().c;
  if (noAttachments > 0) findings.push({ severity: 'info', check: 'no_attachments', count: noAttachments, detail: 'Reports with zero supporting attachments.' });

  // Exact-duplicate coordinates are a signal worth a human's attention -
  // could be the same incident double-reported by two people, or a form
  // that silently reused a previous location.
  const duplicateCoords = db.prepare(`
    SELECT lat, lng, COUNT(*) AS c FROM reports GROUP BY lat, lng HAVING c > 1
  `).all();
  if (duplicateCoords.length > 0) {
    findings.push({
      severity: 'warn', check: 'duplicate_coordinates', count: duplicateCoords.length,
      detail: `${duplicateCoords.length} coordinate pair(s) used by more than one report - possible duplicate submissions.`,
      examples: duplicateCoords.slice(0, 5)
    });
  }

  // Same victim name reported more than once - could be legitimate
  // (common name) or a duplicate submission; flagged for review, not
  // auto-merged.
  const duplicateNames = db.prepare(`
    SELECT victim_name, COUNT(*) AS c FROM reports GROUP BY victim_name HAVING c > 1
  `).all();
  if (duplicateNames.length > 0) {
    findings.push({
      severity: 'warn', check: 'duplicate_victim_name', count: duplicateNames.length,
      detail: `${duplicateNames.length} victim name(s) appear on more than one report.`,
      examples: duplicateNames.slice(0, 5).map(r => r.victim_name)
    });
  }

  // Malformed reporter_id_card that somehow bypassed both the API-layer
  // and DB-layer validation (e.g. inserted before those checks existed,
  // or via a direct DB write).
  const badIdCard = db.prepare(`
    SELECT COUNT(*) AS c FROM reports
    WHERE reporter_id_card IS NOT NULL AND reporter_id_card != '' AND LENGTH(reporter_id_card) != 13
  `).get().c;
  if (badIdCard > 0) findings.push({ severity: 'error', check: 'malformed_id_card', count: badIdCard, detail: 'reporter_id_card values that are not exactly 13 digits.' });

  const orphanedAttachments = db.prepare(`
    SELECT COUNT(*) AS c FROM attachments a
    WHERE NOT EXISTS (SELECT 1 FROM reports r WHERE r.id = a.report_id)
  `).get().c;
  if (orphanedAttachments > 0) findings.push({ severity: 'error', check: 'orphaned_attachments', count: orphanedAttachments, detail: 'Attachment rows with no matching report (should be impossible with the FK CASCADE - would indicate a data integrity bug).' });

  return findings;
}

if (require.main === module) {
  const findings = run();
  if (!findings.length) {
    console.log('No data quality issues found.');
  } else {
    console.log(`${findings.length} data quality finding(s):\n`);
    for (const f of findings) {
      console.log(`[${f.severity.toUpperCase()}] ${f.check} (${f.count}): ${f.detail}`);
      if (f.examples) console.log(`  examples: ${JSON.stringify(f.examples)}`);
    }
  }
}

module.exports = { run };
