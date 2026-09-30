(function (root, factory) {
  const rules = factory();
  if (typeof module === "object" && module.exports) module.exports = rules;
  else root.castRegistrationRules = rules;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const categories = Object.freeze({
    men: "شباب", women: "بنات", boys: "أطفال أولاد", girls: "أطفال بنات",
    seniorMen: "كبار سن رجال", seniorWomen: "كبار سن سيدات",
  });
  const publicFields = Object.freeze([
    "id", "name", "category", "folderUrl", "photoUrl", "imageTitle",
    "age", "height", "weight", "nationality", "speaking",
  ]);
  const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
  const videoTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);
  const limits = Object.freeze({ videoBytes: 2 * 1024 ** 3 });

  function normalizeDigits(value) {
    return String(value ?? "").replace(/[٠-٩۰-۹]/g, function (digit) {
      const code = digit.charCodeAt(0);
      return String(code >= 0x6f0 ? code - 0x6f0 : code - 0x660);
    }).trim();
  }

  function number(value) {
    const normalized = normalizeDigits(value).replace(/٫/g, ".");
    return /^\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
  }

  function classify(gender, age) {
    const value = number(age);
    if (!["male", "female"].includes(gender) || !Number.isInteger(value) || value < 0 || value > 120) {
      throw new Error("الجنس أو العمر غير صحيح");
    }
    if (value < 15) return gender === "male" ? "boys" : "girls";
    if (value >= 50) return gender === "male" ? "seniorMen" : "seniorWomen";
    return gender === "male" ? "men" : "women";
  }

  function phone(value) {
    const normalized = normalizeDigits(value).replace(/[\s()-]/g, "").replace(/^00/, "+");
    return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : "";
  }

  function driveFolder(value) {
    try {
      const url = new URL(String(value || ""));
      if (url.protocol !== "https:" || url.hostname !== "drive.google.com"
        || url.username || url.password || url.port) return "";
      const match = /^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,100})\/?$/.exec(url.pathname);
      return match ? "https://drive.google.com/drive/folders/" + match[1] : "";
    } catch { return ""; }
  }

  function validate(input) {
    input = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const errors = {};
    const profile = {
      name: String(input.name || "").trim(), gender: input.gender,
      age: number(input.age), height: number(input.height), weight: number(input.weight),
      nationality: String(input.nationality || "").trim(), speaking: input.speaking,
    };
    if (!profile.name || profile.name.length > 120 || /[\u0000-\u001f\u007f]/.test(profile.name)) {
      errors.name = "أدخل الاسم، بحد أقصى 120 حرفًا";
    }
    if (!["male", "female"].includes(profile.gender)) errors.gender = "حدد ذكر أو أنثى";
    if (!Number.isInteger(profile.age) || profile.age < 0 || profile.age > 120) errors.age = "أدخل العمر بالسنوات";
    if (!Number.isFinite(profile.height) || profile.height <= 0 || profile.height > 250) errors.height = "أدخل الطول بالسنتيمتر";
    if (!Number.isFinite(profile.weight) || profile.weight <= 0 || profile.weight > 300) errors.weight = "أدخل الوزن بالكيلوجرام";
    if (profile.nationality.length > 80) errors.nationality = "الجنسية أطول من الحد المسموح";
    if (!["yes", "no"].includes(profile.speaking)) errors.speaking = "حدد متحدث أو غير متحدث";
    const whatsapp = phone(input.whatsapp);
    if (!whatsapp) errors.whatsapp = "أدخل رقم واتساب مع رمز الدولة، مثل +966";
    const mode = input.worksMode;
    const folderUrl = mode === "drive" ? driveFolder(input.folderUrl) : "";
    if (!["drive", "upload"].includes(mode)) errors.worksMode = "حدد طريقة إضافة الأعمال";
    if (mode === "drive" && !folderUrl) errors.folderUrl = "أدخل رابط مجلد Google Drive صحيح";
    if (!errors.gender && !errors.age) profile.category = classify(profile.gender, profile.age);
    return { valid: Object.keys(errors).length === 0, errors, profile,
      privateContact: { whatsapp }, works: { mode, folderUrl } };
  }

  function validateAttachments(files, mode, fileLimits = limits) {
    const errors = {};
    if (!["drive", "upload"].includes(mode)) errors.worksMode = "حدد طريقة إضافة الأعمال";
    if (!Array.isArray(files)) return { valid: false, errors: { files: "المرفقات غير صحيحة" } };
    if (files.some(file => !file || typeof file !== "object" || Array.isArray(file))) {
      return { valid: false, errors: { files: "المرفقات غير صحيحة" } };
    }
    const portraits = files.filter(file => file.role === "portrait");
    const works = files.filter(file => file.role === "work");
    if (portraits.length !== 1) errors.portrait = "أرفق صورة بروفايل واحدة";
    if (mode === "upload" && (works.length < 2 || works.length > 10)) errors.works = "أرفق من عملين إلى 10 أعمال، غير صورة البروفايل";
    if (mode === "drive" && works.length) errors.works = "أرفق صورة البروفايل فقط عند استخدام رابط الدرايف";
    const ids = new Set();
    files.forEach((file, index) => {
      const key = "file-" + index;
      if (!["portrait", "work"].includes(file.role)) errors[key] = "نوع المرفق غير صحيح";
      if (!Number.isSafeInteger(file.size) || file.size <= 0) errors[key] = "الملف فارغ أو غير صحيح";
      const image = imageTypes.has(file.type);
      const video = videoTypes.has(file.type);
      if ((!image && !video) || (file.role === "portrait" && !image)) errors[key] = "اختر صورة أو مقطع فيديو مدعوم";
      const limit = image ? fileLimits.imageBytes : fileLimits.videoBytes;
      if (Number.isSafeInteger(limit) && limit > 0 && file.size > limit) errors[key] = "حجم الملف يتجاوز حد الرفع";
      if (file.id) {
        if (ids.has(file.id)) errors[key] = "المرفق مكرر";
        ids.add(file.id);
      }
    });
    return { valid: Object.keys(errors).length === 0, errors, workCount: works.length };
  }

  function reviewReadiness(request) {
    const errors = [];
    if (!["pending", "approved"].includes(request.status)) errors.push("الطلب غير جاهز للاعتماد");
    const result = validate({ ...request.profile, whatsapp: request.privateContact?.whatsapp,
      worksMode: request.works?.mode, folderUrl: request.works?.folderUrl });
    if (!result.valid) errors.push(...Object.values(result.errors));
    const attachments = validateAttachments(request.attachments, request.works?.mode);
    if (!attachments.valid) errors.push(...Object.values(attachments.errors));
    if (Array.isArray(request.attachments) && request.attachments.some(file => file.verified !== true)) {
      errors.push("لم يكتمل التحقق من المرفقات في التخزين الخاص");
    }
    if (request.works?.mode === "drive"
      && (!Number.isInteger(request.works.reviewedCount) || request.works.reviewedCount < 2 || request.works.reviewedCount > 10
        || request.works.accessible !== true)) {
      errors.push("تحقق من إتاحة مجلد الدرايف ووجود عملين إلى 10 أعمال فيه");
    }
    return { valid: errors.length === 0, errors };
  }

  function publicProfile(request, approvedMedia) {
    if (request.status !== "approved") throw new Error("لا يمكن نشر طلب قبل اعتماده");
    const readiness = reviewReadiness(request);
    if (!readiness.valid) throw new Error(readiness.errors.join("؛ "));
    if (!/^registration-[a-f0-9-]{36}$/.test(request.profileId || "")) throw new Error("معرف البروفايل غير صحيح");
    const folderUrl = driveFolder(approvedMedia.folderUrl);
    const photoId = approvedMedia.photoId;
    if (!folderUrl || !/^[A-Za-z0-9_-]{10,100}$/.test(photoId || "")) throw new Error("روابط النشر غير جاهزة");
    const profile = request.profile;
    const speaking = profile.gender === "female"
      ? profile.speaking === "yes" ? "متحدثة" : "غير متحدثة"
      : profile.speaking === "yes" ? "متحدث" : "غير متحدث";
    // A strict allowlist keeps contact details out of public JS, even after approval.
    return {
      id: request.profileId, name: profile.name.trim(), category: classify(profile.gender, profile.age),
      folderUrl, photoUrl: "https://drive.google.com/thumbnail?id=" + photoId + "&sz=w1000",
      imageTitle: "صورة البروفايل", age: String(number(profile.age)), height: String(number(profile.height)),
      weight: String(number(profile.weight)), nationality: String(profile.nationality || "").trim(), speaking,
    };
  }

  return Object.freeze({ categories, publicFields, limits, normalizeDigits, classify, phone,
    driveFolder, validate, validateAttachments, reviewReadiness, publicProfile });
});
