# Cast Registration: Approved Requirements

Status (2026-10-01): rules, private runtime, resumable-upload form and private
review editor implemented. Runtime and encrypted Drive-connection support are
deployed, including the private review Pages UI. Protected anonymous intake was
opened after owner-approved Turnstile setup and Production Google re-consent.
Google client credentials are configured in the backend. Limited owner consent
completed and encrypted connection persistence was verified on 2026-10-01.
Durable approval/transfer and the private approval editor are implemented. The
broker, worker, job schema and minute dispatcher are deployed. Bot protection and
same-scope Google Production authorization are configured. Synthetic small-media
publication, post-approval edits, Drive-link publication and rejection passed live.
The synthetic 2 GiB upload, resumable Drive transfer and deployed publication also
passed; this is transport qualification, not a natural 2 GiB video's playback test.
Scope: anas3719/cast only. Do not modify the portfolio repository.

## Applicant Form

- Required: name, gender (male/female), age, height in cm, weight in kg,
  speaking (yes/no), international WhatsApp number and one portrait image.
- Optional: nationality. No red asterisks; use labels and inline validation.
- Arabic and Persian digits are normalized without silently accepting units.
- No additional guardian workflow, as explicitly requested by the owner.
- Submit creates a private pending record, never a public catalog profile.
- Upload mode requires 2-10 image/video works in addition to the portrait.
- Drive mode requires a valid folder URL; owner verifies access and 2-10 works
  inside that folder before approval. Do not trust an applicant-supplied count.
- No video compression. Owner approved 2 GiB per video (2,147,483,648 bytes).
  Incremental project compute cost was approved. Global and bucket-level
  limits were both verified at 2 GiB; no organization spend-cap change.

## Automatic Classification

Age below 15: boys/girls. Age 15-49: men/women. Age 50 and above:
seniorMen/seniorWomen. Exact boundaries are covered by tests.

## Privacy and Ownership

- All pending records, phone numbers, upload manifests, signed upload URLs,
  internal notes and rejected records stay in private server-side storage.
- GitHub owner login protects review and edit operations; no new admin password.
- Do not put applicant contacts in cast-data.js, public GitHub commits, public
  asset filenames, public Drive folders, metadata, analytics or error logs.
- Build published profiles from an explicit field allowlist, not an object spread.
- The existing admin's generic serializeMembers must not receive a private
  registration object. Connect only the validated public projection.
- After approval, phone edits continue in the private record, separate from
  the normal published-profile editor. Category/name changes do not lose contact.
- No public listing or public read/update access to pending registrations.
- A signed upload grants access only to an allocated object, never the bucket
  or owner Google credentials. Verify completed object size/type server-side;
  browser MIME and a supplied verified flag are not proof.
- Enforce upload quotas, rate limits and bot protection before opening anonymous
  upload. Clean up expired unfinished uploads without removing approved works.

## Storage and Drive Flow

1. Reserve a request ID and a bounded private upload manifest.
2. Upload originals directly to private storage with resumable uploads.
   Large video bytes must not pass through Vercel request/response bodies.
3. Verify objects and save the pending record. Return a receipt only after
   durable persistence. Retrying the same request must not create duplicates.
4. Owner edits pending fields and reviews original media with short-lived URLs.
5. Approval locks the record revision, creates a Drive folder in the correct
   category, and transfers accepted originals. Persist resumable transfer state.
   Retrying an uncertain approval must reconcile existing folder/file IDs.
6. Only after accepted media transfer and sharing succeed, publish the public
   profile through the existing cast-only GitHub publication path.
7. Track GitHub commit and deployment separately. A failed or pending deploy is
   not a successful live publication. Preserve the private contact throughout.

For existing applicant-owned Drive links, retain their works folder link and
publish the selected portrait separately at approval; do not make a publicly
shared folder containing the applicant's contact record.

## Activation Prerequisites

- On 2026-09-30 the owner replaced the separate-organization choice with a
  separate project inside the existing bannay-clients Pro organization.
  Project cast-registrations: vmnkdbceyqudcxddvljx, region ap-south-1.
  Owner accepted approximately USD 10/month incremental project compute cost.
  Only organization billing/usage allowances are shared; client databases,
  storage buckets, project keys and project settings must not be touched.
- Private bucket cast-registration-private, 2 GiB bucket-level limit.
- Five private tables use RLS with no browser policies and explicit revocation
  of anon/authenticated privileges; server-only service_role access is intended.
- Live rollback tests passed for gender/age classification boundaries, rejecting
  missing Drive URLs, video portraits and oversized videos, and anonymous reads.
  No synthetic registration records were retained.
- Security advisor reports informational RLS-enabled-with-no-policy notices for
  the deliberately server-only tables; do not add browser access to silence them.
  It also reports pg_net installed in public. Its request API is in the net
  schema and only the fixed server-side job dispatcher uses it. This deployment
  warning remains tracked rather than changing extension system metadata.
- Owner approved an independent app-created root named
  "الكاست - التسجيلات المعتمدة", containing the six cast categories. No existing
  customer folders need to be selected or accessed. Use only drive.file scope.

### Primary folder linking (2026-10-08)

- The owner now requests saving inside the six original cast categories.
  `lib/drive-destinations.json` binds their verified IDs and the previous
  app-created category IDs. No other Drive destinations are accepted.
- OAuth uses Google's `trigger_onepick` flow with `drive.file`, PKCE and
  the fixed seven-folder filter. The callback requires exactly those IDs;
  the server independently verifies each category's parent and add-child
  capability before storing the new encrypted connection.
- `cast_set_official_drive` locks the same integration row as approval startup,
  refuses active jobs, and is executable only by the backend service role.
- Existing approved app-owned person folders move by verified parent ID,
  retaining their IDs, names, media and public links. Retries reconcile the
  destination; unrelated folders are never moved and missing folders are not
  recreated by migration. The previous root is retained, not deleted.
- Google reference: https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker
  OAuth project anas-cast-registration has Drive API enabled and branding saved;
  its web client uses the cast-admin backend callback, not a portfolio callback.
  Google credentials stay encrypted in a server-only integration table.
- The web client was created and its saved callback was verified. Client ID and
  secret are server-only Vercel production variables; the local setup file is
  excluded from Git and deployment uploads. Live Drive health reports configured.
  The owner approved conversion from Testing to Production on 2026-10-01 and
  renewed consent with the same drive.file scope. The application backend still
  restricts connection and review to its GitHub owner.
- Durable approval jobs use private per-job capabilities, revision checks and
  expiring single-worker leases. Folder/file IDs, sealed resumable handles,
  acknowledged offsets and GitHub commit receipts persist before advancing.
  The dispatcher resumes bounded batches after the admin tab closes. A complete
  byte range is not completion without finalized Drive metadata. Git publication
  retries reconcile the current catalog and verify the live public projection.
- Configure bot protection and long-lived same-scope Drive authorization before
  opening intake. Approved source-copy retention and expired-upload cleanup
  remain unresolved; the upload reservation budget must not be ignored.
- End-to-end staging test: submit -> reload admin -> edit -> approve -> public
  profile; verify contacts are absent from every public output and private media
  is inaccessible without a signed URL. Test retry, two simultaneous approvals,
  age boundaries, rejection and interrupted large-video upload.

## Current Checks

Run `npm test`: 42 focused Node tests and the existing admin-auth recovery check.
Synthetic browser checks passed for optional nationality, portrait upload via
TUS, a pending-only receipt, private field editing, lost-save acknowledgement
recovery without replay, and RTL layouts at desktop and 390x844.
Database rollback checks retained no synthetic applicants. Integration RLS is
enabled and both anonymous and signed-in browser read privileges are revoked.
Additional rollback checks passed for revision races, exclusive/stale leases,
phase bounds, publication receipts and browser-role restrictions. Zero synthetic
applicants remained after rollback. Synthetic approval UI checks passed for a
lost approval acknowledgement and read-only recovery without repeating approval;
the 390x844 viewport measured page width 390 and dialog width 352.
These checks are not proof of 2 GiB live transfer or end-to-end publication.

Production Vercel broker deployment dpl_453VTFJeh1Pq8uAzkYo7pUC4XJdu is Ready.
Supabase cast-registration-work version 1 and cast-registration version 5 are
Active. Invalid worker tickets and broker grants were rejected in live probes.
The owner completed Cloudflare two-factor authentication and specifically approved
creation of the Managed widget for anas3719.github.io and storage of its secret in
the dedicated cast project. TURNSTILE_SECRET, TURNSTILE_SITE_KEY,
APPROVAL_PIPELINE_READY and REGISTRATION_OPEN are configured. The live availability
response reports open=true, and the rendered widget showed successful verification.
No credential value was included in the output or public repository. Pages build
36829746406 deployed source d3b6c55 successfully, including the public privacy page.

The first consent return was rejected before exchanging any code. Safe production
logs showed a start-to-return interval of approximately 43 minutes, beyond the
10-minute state/cookie lifetime. Keep that boundary; expired or missing state
now returns a fixed, non-sensitive reason and opens the review dialog automatically.
Do not treat a completed Google consent screen as proof of stored connection.

On 2026-10-01 a fresh same-scope consent completed within the state lifetime.
The live private review dialog showed "ربط الدرايف محفوظ في الخدمة الخلفية".
A server-side read of only id, connected_at and a boolean confirmed the
encrypted google-drive connection was saved at 06:03:01.876 UTC. No token,
authorization code or encrypted payload was read into the verification output.
At that initial milestone the anonymous availability endpoint returned open=false
and an empty siteKey. No applicant or public profile was created by verification.

Google was initially External/Testing, which imposes a seven-day refresh-token
limit. On 2026-10-01 the owner explicitly approved Production conversion; the
console showed In production, and fresh consent persisted at 07:30:26.757 UTC.
Live owner health then verifies Google access rather than mere stored ciphertext.
Production does not guarantee perpetual credentials; revocation or account/policy
changes must still fail safely and request reconnection. Reference:
https://developers.google.com/identity/protocols/oauth2#expiration

Final live readback before delivery: zero registrations, zero approval jobs, zero
private objects and one active dispatcher. The workflow is deployed and open,
not qualified by a real applicant approval or a full-size provider transfer.

## Synthetic Provider Qualification - 2026-10-01

The owner approved disposable synthetic public profiles and a full 2 GiB test,
followed by cleanup. A real small-media submission exposed defects missed by
mocked checks: signature-only TUS requires the `/sign` route; rotating Turnstile
proof must not enter retry identity; signing retries must omit completed files;
Drive resumable 308 acknowledgements must be read without following redirects.
The corrected small-media workflow reached live publication, then a saved owner
edit automatically moved it between categories and republished it. Anonymous
thumbnail retrieval succeeded. Contact and owner-note markers remained private.

The owner separately approved deleting only unfinished uploads older than 48
hours. The `cast-registration-cleanup` worker authenticates a private random
capability, takes a single lease, expires only unfinished records, removes their
objects through Storage API, and deletes metadata only after a database check
confirms no object remains. Pending, approving and approved records are excluded.
The hourly dispatcher has no credential literal. Verified immutable files count
their actual bytes; unverified signed destinations still reserve the full bucket
limit. No private source files of submitted or approved requests are auto-deleted.

Rollback checks cover cleanup boundaries, protected statuses, wrong capabilities,
single leases, retained storage objects, worst-case quota, verified-byte quota,
and per-client rate limits. A real cleanup removed three abandoned synthetic
requests and their completed object, while current submissions stayed intact.
The 2 GiB test upload has completed and matches Storage metadata exactly; Drive
transfer and final publication qualification are still in progress at this point.

## Private Origin Range Transfer

The real 2 GiB trial exposed a CDN range-read stall that mocks did not reproduce.
Approval now reads at most 8 MiB through `cast-registration-chunk`, using the
Storage S3 origin. Authorization requires the current job's random capability,
live lease, transfer phase, matching registration revision and verified file.
The broker fixes the destination and file ID from its encrypted grant; clients
cannot override the object, endpoint or byte limit. Exact 206 Content-Range is
required. No bucket is public and no Storage credential leaves Supabase.

Configure `CAST_S3_ANON_SIGNING_KEY` and `CAST_S3_SERVICE_SESSION` only as encrypted
Edge Function secrets in this dedicated project. They contain the project's
existing legacy anon and service_role JWT respectively. Do not use the automatically
injected values merely because their environment names contain ANON or SERVICE_ROLE:
the current runtime supplied modern API keys, which are incompatible with this
S3 session-authentication protocol. Do not commit these values or put them in Vercel,
browser state, logs or applicant payloads. Existing server credentials for database
access stay unchanged; no new all-bucket S3 credential is created.

References: https://supabase.com/docs/guides/storage/s3/authentication and
https://supabase.com/docs/guides/storage/s3/compatibility

On 2026-10-01 the full-size job reached phase 5 / done and its private request
became approved. Independent Google Drive metadata returned video/mp4 and
2,147,483,648 bytes. The deployed men page displayed the synthetic profile and
its folder link; the associated portrait and second work also finished transfer.
The artificial video used a valid short clip plus padding to exercise exact-size
transport. Do not represent this as real-device or natural long-video playback.
The public cleanup restores all 77 pre-test cast records and their ordering,
without changing the separate photographer catalog or real-person media.

Post-trial cleanup verified zero private registrations, jobs, file manifests,
events and Storage objects. Only the four known synthetic requests were expired
for the guarded cleanup worker; approved/rejected real requests were not targeted.
The three synthetic Drive person folders were moved to recoverable Trash, not
permanently purged. The local 2 GiB fixture was removed after its exact path and
size were checked. Live catalog data compares equal to the pre-trial 77 records,
and the unchanged two-photographer catalog gives 79 total admin profiles.
Both the minute approval dispatcher and approved hourly cleanup remain active.
Drive authorization remains stored. All 54 tests and auth recovery checks pass.
Fresh Chrome review at 390x844 measured a 352px dialog with no horizontal overflow;
the registration form and desktop views were also rendered and inspected.
Physical iOS/Android devices, Safari, load testing and natural long-video playback
were not exercised. Do not call this exhaustive production or security assurance.
