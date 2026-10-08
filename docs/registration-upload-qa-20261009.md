# Registration Upload QA - 2026-10-09

Scope: the existing public registration URL and its private intake service. No
customer project, real applicant record, public cast profile or Drive folder was
modified by these tests.

## Confirmed Failure And Fix

A synthetic ISO video selected as a MOV file successfully reached private
Storage, but the old backend rejected its header because it required only the
QuickTime major brand for that declared MIME. The same registration reached
`pending` after the signature correction, without re-upload or a duplicate
request. Storage independently showed three verified objects with exact sizes
and MIME types.

The header check now recognizes supported major/compatible ISO brands, bounded
leading padding, and legacy QuickTime movie/data atoms. It is file-signature
recognition, not full audiovisual decoding. Unknown renamed content remains
rejected. Picker MIME aliases and generic MIME fallbacks remain limited to the
existing allowed image/video formats.

The browser uses page-local resumable URL storage, bounded API/XHR waits,
cryptographically random request IDs on older browsers, per-file signing and
file-specific progress/failure messages. This does not persist applicant drafts
across closing or reloading the page.

## Verification Matrix

| Scenario | Evidence | Result |
| --- | --- | --- |
| Official URL and cache-busted client | Live Chrome DOM, GitHub Pages run 37849585818 | Passed |
| Portrait and multiple-file choosers | Actual Chrome file chooser selections | Passed |
| PNG plus MOV upload | Actual private Storage and same-request retry receipt | Passed |
| Portrait plus maximum ten works | Actual new-client upload, 11 verified exact Storage objects | Passed |
| Interrupt and resume | Stopped near 24%; HEAD acknowledged offset 18,559,787, then PATCH reached 67,108,864 bytes | Passed |
| Private review without public approval | Actual pending receipt, no approval job/public profile | Passed |
| Arabic numerals, optional nationality, age category | Actual age 14 female intake classified as girls; local age 50 form; classification unit boundaries | Passed |
| Invalid required fields and invalid Drive URL | Local rendered form and validation tests | Passed |
| Drive URL mode with separate portrait | Local synthetic browser receipt and rule tests, not live Drive access | Passed within stated scope |
| 0/1/11 works, empty files and unsupported formats | Automated validation tests | Passed |
| Exact 2 GiB allowed, greater rejected | Automated size-boundary tests; bucket limit independently remains 2,147,483,648 | Passed boundary checks only |
| MIME aliases, denied browser storage, older UUID API | Isolated frontend tests | Passed |
| Lost submission acknowledgement, completed-file skip, fresh signing | Isolated frontend tests | Passed |
| Authentication, origin, privacy, cleanup protections | Existing automated regression suite | Passed |
| Desktop and mobile-width layout | Actual Chrome render, explicit tab viewport 390x844; no horizontal overflow | Passed |

All 77 automated tests and the separate admin-auth recovery check passed. The
live 64 MiB transport fixture contains a valid short video followed by padding;
this proves resumable byte transport, not natural long-video playback.

## Test Records And Limits

Two named synthetic intake records were moved from pending to rejected after
verification. Their media remains private and their state change is reversible.
No permanent purge or public approval was performed. Real pending/uploading
requests were not altered. Private test objects total approximately 64 MiB.

Physical Safari/iOS, physical Android, WhatsApp embedded browsers and fresh
2 GiB byte transport were not tested in this run. Earlier large-file tests are
historical evidence, not a current all-device guarantee. No load/security audit
or guarantee for every codec, device and connection is implied.

Screenshots are under the local `cast-qa-20261009` evidence directory outside the
repository. Provider capability tokens and applicant contact data are excluded
from this report.

Format references:
- https://developer.apple.com/documentation/quicktime-file-format/file_type_compatibility_atom
- https://developer.apple.com/documentation/quicktime-file-format/atoms
- https://supabase.com/docs/guides/storage/uploads/resumable-uploads
