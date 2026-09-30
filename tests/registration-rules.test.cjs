const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../cast-registration-rules.js');

const fields = () => ({ name: 'اختبار التسجيل', gender: 'male', age: '25', height: '171',
  weight: '70', nationality: '', speaking: 'yes', whatsapp: '+966599000000', worksMode: 'upload' });
const portrait = () => ({ id: 'portrait', role: 'portrait', type: 'image/jpeg', size: 1000, verified: true });
const works = count => Array.from({ length: count }, (_, index) => ({ id: 'work-' + index,
  role: 'work', type: index % 2 ? 'video/mp4' : 'image/png', size: 2000, verified: true }));
const request = () => ({ status: 'approved', profileId: 'registration-12345678-1234-1234-1234-123456789abc',
  profile: rules.validate(fields()).profile, privateContact: { whatsapp: '+966599000000' },
  works: { mode: 'upload' }, attachments: [portrait(), ...works(2)] });

test('malformed anonymous payloads return validation errors', () => {
  for (const value of [undefined, null, 'wrong', []]) assert.equal(rules.validate(value).valid, false);
  for (const value of [undefined, null, [null], ['wrong'], [[]]]) {
    assert.equal(rules.validateAttachments(value, 'upload').valid, false);
  }
});

test('exact age boundaries for both genders', () => {
  for (const [gender, expected] of [['male', ['boys', 'men', 'men', 'seniorMen']],
    ['female', ['girls', 'women', 'women', 'seniorWomen']]]) {
    [14, 15, 49, 50].forEach((age, index) => assert.equal(rules.classify(gender, age), expected[index]));
  }
  assert.equal(rules.classify('male', '١٤'), 'boys');
  assert.throws(() => rules.classify('other', 25));
  assert.throws(() => rules.classify('male', ''));
  assert.throws(() => rules.classify('female', '15years'));
  assert.throws(() => rules.classify('male', 14.5));
});

test('required fields and optional nationality, including Arabic numerals', () => {
  assert.equal(rules.validate(fields()).valid, true);
  const arabic = rules.validate({ ...fields(), age: '٢٥', height: '۱۷۱', weight: '٧٠٫٥' });
  assert.equal(arabic.valid, true);
  assert.equal(arabic.profile.weight, 70.5);
  assert.equal(arabic.profile.category, 'men');
  for (const key of ['name', 'gender', 'age', 'height', 'weight', 'speaking', 'whatsapp']) {
    assert.equal(rules.validate({ ...fields(), [key]: '' }).valid, false, key);
  }
  for (const age of [-1, 121, 'abc']) assert.equal(rules.validate({ ...fields(), age }).valid, false);
  assert.equal(rules.validate({ ...fields(), height: 0 }).valid, false);
  assert.equal(rules.validate({ ...fields(), weight: 0 }).valid, false);
});

test('international private phone; reject ambiguous local numbers', () => {
  assert.equal(rules.phone('٠٠٩٦٦ ٥٩٩-٠٠٠-٠٠٠'), '+966599000000');
  assert.equal(rules.phone('+20 100 000 0000'), '+201000000000');
  assert.equal(rules.phone('0599000000'), '');
  assert.equal(rules.phone('+0123456789'), '');
});

test('only genuine HTTPS Drive folder links are accepted', () => {
  assert.equal(rules.driveFolder('https://drive.google.com/drive/folders/abcdefghijk?usp=sharing'),
    'https://drive.google.com/drive/folders/abcdefghijk');
  assert.ok(rules.driveFolder('https://drive.google.com/drive/u/0/folders/abcdefghijk'));
  for (const link of ['javascript:alert(1)', 'http://drive.google.com/drive/folders/abcdefghijk',
    'https://drive.google.com.evil.com/drive/folders/abcdefghijk',
    'https://evil@drive.google.com/drive/folders/abcdefghijk', 'https://drive.google.com/file/d/abcdefghijk/view']) {
    assert.equal(rules.driveFolder(link), '');
  }
});

test('one portrait is separate from the minimum 2 and maximum 10 works', () => {
  for (const count of [0, 1, 11]) assert.equal(rules.validateAttachments([portrait(), ...works(count)], 'upload').valid, false);
  for (const count of [2, 10]) assert.equal(rules.validateAttachments([portrait(), ...works(count)], 'upload').valid, true);
  assert.equal(rules.validateAttachments(works(2), 'upload').valid, false);
  assert.equal(rules.validateAttachments([portrait(), portrait(), ...works(2)], 'upload').valid, false);
  assert.equal(rules.validateAttachments([{ ...portrait(), type: 'video/mp4' }, ...works(2)], 'upload').valid, false);
  assert.equal(rules.validateAttachments([{ ...portrait(), size: 0 }, ...works(2)], 'upload').valid, false);
  assert.equal(rules.validateAttachments([portrait(), { ...works(1)[0], type: 'text/html' }, works(2)[1]], 'upload').valid, false);
});

test('videos allow 2 GiB, reject larger files and have no hidden 50 MB cap', () => {
  const files = [portrait(), ...works(2)];
  files[2].size = 900 * 1024 * 1024;
  assert.equal(rules.validateAttachments(files, 'upload', { videoBytes: 1024 ** 3 }).valid, true);
  assert.equal(rules.validateAttachments(files, 'upload', { videoBytes: 500 * 1024 ** 2 }).valid, false);
  files[2].size = 2 * 1024 ** 3;
  assert.equal(rules.validateAttachments(files, 'upload').valid, true);
  files[2].size += 1;
  assert.equal(rules.validateAttachments(files, 'upload').valid, false);
});

test('Drive link mode needs an explicit owner review of 2 to 10 accessible works', () => {
  const value = request();
  value.attachments = [portrait()];
  value.works = { mode: 'drive', folderUrl: 'https://drive.google.com/drive/folders/abcdefghijk' };
  assert.equal(rules.reviewReadiness(value).valid, false);
  value.works.reviewedCount = 2;
  value.works.accessible = true;
  assert.equal(rules.reviewReadiness(value).valid, true);
  value.works.reviewedCount = 11;
  assert.equal(rules.reviewReadiness(value).valid, false);
});

test('pending, unverified and invalid records cannot be published', () => {
  const media = { folderUrl: 'https://drive.google.com/drive/folders/abcdefghijk', photoId: 'abcdefghijk' };
  assert.throws(() => rules.publicProfile({ ...request(), status: 'pending' }, media));
  const value = request();
  value.attachments[0].verified = false;
  assert.throws(() => rules.publicProfile(value, media));
  const invalid = request(); invalid.profile.height = '';
  assert.throws(() => rules.publicProfile(invalid, media));
});

test('approved public data never contains WhatsApp, private fields or upload credentials', () => {
  const value = request();
  value.profile.whatsapp = '+966599000000';
  value.profile.uploadToken = 'synthetic-upload-token';
  value.ownerNotes = 'PRIVATE-NOTES';
  value.attachments[0].signedUrl = 'PRIVATE-SIGNED-URL';
  const result = rules.publicProfile(value, {
    folderUrl: 'https://drive.google.com/drive/folders/abcdefghijk', photoId: 'abcdefghijk',
  });
  assert.deepEqual(Object.keys(result).sort(), [...rules.publicFields].sort());
  const serialized = JSON.stringify(result);
  for (const secret of ['+966599000000', 'whatsapp', 'uploadToken', 'PRIVATE-NOTES', 'PRIVATE-SIGNED-URL']) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.equal(result.nationality, '');
});

test('public data derives category and speaking labels from validated fields', () => {
  const value = request();
  Object.assign(value.profile, { gender: 'female', age: '٥٠', category: 'men', speaking: 'no' });
  const result = rules.publicProfile(value, {
    folderUrl: 'https://drive.google.com/drive/folders/abcdefghijk', photoId: 'abcdefghijk',
  });
  assert.equal(result.category, 'seniorWomen');
  assert.equal(result.speaking, 'غير متحدثة');
  assert.equal(result.age, '50');
});
