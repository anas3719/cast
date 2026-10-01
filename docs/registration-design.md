# Cast Registration: Approved Requirements

Status (2026-10-01): rules, private runtime, resumable-upload form and private
review editor implemented. Runtime and encrypted Drive-connection support are
deployed, including the private review Pages UI. Protected anonymous intake was
opened after owner-approved Turnstile setup and Production Google re-consent.
Google client credentials are configured in the backend. Limited owner consent
completed and encrypted connection persistence was verified on 2026-10-01.
Durable approval/transfer and the private approval editor are implemented. The
broker, worker, job schema and minute dispatcher are deployed. Bot protection and
same-scope Google Production authorization are configured. Actual end-to-end
applicant publication and a full 2 GiB transfer remain unverified.
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
