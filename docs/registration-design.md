# Cast Registration: Approved Requirements

Status (2026-09-30): rules, private runtime, resumable-upload form and private
review editor implemented. Runtime and encrypted Drive-connection support are
deployed, while the new Pages UI remains local. Anonymous intake stays closed.
Google client credentials are configured in the backend; owner consent,
durable approval/transfer, bot protection
and actual publication acceptance remain unfinished; no feature-complete claim.
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
- Three private tables use RLS with no browser policies and explicit revocation
  of anon/authenticated privileges; server-only service_role access is intended.
- Live rollback tests passed for gender/age classification boundaries, rejecting
  missing Drive URLs, video portraits and oversized videos, and anonymous reads.
  No synthetic registration records were retained.
- Security advisor reports only informational RLS-enabled-with-no-policy notices
  for these deliberately server-only tables; do not add browser access to silence
  that notice.
- Owner approved an independent app-created root named
  "الكاست - التسجيلات المعتمدة", containing the six cast categories. No existing
  customer folders need to be selected or accessed. Use only drive.file scope.
  OAuth project anas-cast-registration has Drive API enabled and branding saved;
  its web client uses the cast-admin backend callback, not a portfolio callback.
  Google credentials stay encrypted in a server-only integration table.
- The web client was created and its saved callback was verified. Client ID and
  secret are server-only Vercel production variables; the local setup file is
  excluded from Git and deployment uploads. Live Drive health reports configured.
  The owner is the sole Google test user. OAuth is still in Testing mode, so
  long-lived operation must be resolved before final activation.
- Configure durable approval/transfer jobs, signed-upload protection and expiry.
- End-to-end staging test: submit -> reload admin -> edit -> approve -> public
  profile; verify contacts are absent from every public output and private media
  is inaccessible without a signed URL. Test retry, two simultaneous approvals,
  age boundaries, rejection and interrupted large-video upload.

## Current Checks

Run `npm test`: 29 focused Node tests and the existing admin-auth recovery check.
Synthetic browser checks passed for optional nationality, portrait upload via
TUS, a pending-only receipt, private field editing, lost-save acknowledgement
recovery without replay, and RTL layouts at desktop and 390x844.
Database rollback checks retained no synthetic applicants. Integration RLS is
enabled and both anonymous and signed-in browser read privileges are revoked.
These checks are not proof of Google consent, 2 GiB live transfer or publication.
