const castMembers = Array.isArray(window.castMembers) ? window.castMembers : [];
const photographers = Array.isArray(window.photographers) ? window.photographers : [];
const castSections = document.querySelector("#castSections");
const castQuickLinks = document.querySelector("#castQuickLinks");
const castCategoryCards = document.querySelector("#castCategoryCards");
const castOverview = document.querySelector("#castOverview");
const selectedSummary = document.querySelector("#selectedSummary");
const sendCastRequest = document.querySelector("#sendCastRequest");
const whatsappNumber = "966599599527";
const missingValue = "يضاف لاحقًا";
const isCastHomePage = document.body.classList.contains("cast-home-page");
const memberById = new Map(castMembers.map((member) => [member.id, member]));
const selectionStorageKey = "anas-cast-selection-v1";

const fallbackCategories = [
  { key: "men", label: "شباب", group: "شباب", href: "cast-men.html", source: "cast", profileType: "full", selectable: true },
  { key: "women", label: "بنات", group: "بنات", href: "cast-women.html", source: "cast", profileType: "full", selectable: true },
  { key: "boys", label: "اطفال اولاد", group: "اطفال", href: "cast-boys.html", source: "cast", profileType: "full", selectable: true },
  { key: "girls", label: "اطفال بنات", group: "اطفال", href: "cast-girls.html", source: "cast", profileType: "full", selectable: true },
  { key: "seniorMen", label: "كبار سن رجال", group: "كبار سن", href: "cast-senior-men.html", source: "cast", profileType: "full", selectable: true },
  { key: "seniorWomen", label: "كبار سن سيدات", group: "كبار سن", href: "cast-senior-women.html", source: "cast", profileType: "full", selectable: true },
  { key: "photographers", label: "المصورين", group: "المصورين", href: "photographers.html", source: "photographers", profileType: "simple", selectable: false },
];

const defaultColors = {
  start: "#17313a",
  end: "#111427",
  border: "#19f6ff",
  text: "#f4f7ff",
};

const categoryDefinitions = (
  Array.isArray(window.castCategories) && window.castCategories.length
    ? window.castCategories
    : fallbackCategories
).map((category) => ({
  source: "cast",
  profileType: "full",
  selectable: true,
  group: category.label,
  href: `cast-category.html?category=${encodeURIComponent(category.key)}`,
  ...category,
  colors: { ...defaultColors, ...(category.colors || {}) },
}));

const categories = categoryDefinitions.filter((category) => category.source !== "photographers");
const selectableCategories = categories.filter((category) => category.selectable !== false);
const categoryByKey = new Map(categoryDefinitions.map((category) => [category.key, category]));
const categoryLabels = Object.fromEntries(
  categoryDefinitions.map((category) => [category.key, category.label]),
);
const selectedCast = new Set(loadStoredSelection());

function hasNumericOrder(value) {
  return value !== "" && value !== null && value !== undefined && Number.isFinite(Number(value));
}

function hexToRgba(hex, alpha) {
  const value = String(hex || "").replace("#", "");
  const normalized = value.length === 3
    ? value.split("").map((character) => character + character).join("")
    : value;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return `rgba(25, 246, 255, ${alpha})`;
  const number = Number.parseInt(normalized, 16);
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}

function applyCategoryTheme(element, category) {
  if (!element || !category) return;
  const colors = { ...defaultColors, ...(category.colors || {}) };
  element.style.setProperty("--category-start", colors.start);
  element.style.setProperty("--category-end", colors.end);
  element.style.setProperty("--category-border", colors.border);
  element.style.setProperty("--category-text", colors.text);
  element.style.setProperty("--category-border-soft", hexToRgba(colors.border, 0.3));
  element.style.setProperty("--category-border-faint", hexToRgba(colors.border, 0.16));
  element.style.setProperty("--category-glow", hexToRgba(colors.border, 0.24));
}

function getRequestedCategoryKeys() {
  const fromBody = (document.body.dataset.categories || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  if (fromBody.length) return fromBody;

  const fromQuery = new URLSearchParams(window.location.search).get("category");
  return fromQuery ? [fromQuery] : [];
}

function getCategoryCount(category) {
  if (category.source === "photographers") return photographers.length;
  return castMembers.filter((member) => member.category === category.key).length;
}

function loadStoredSelection() {
  try {
    const storedValue = window.localStorage.getItem(selectionStorageKey);
    const storedIds = JSON.parse(storedValue || "[]");
    return Array.isArray(storedIds) ? storedIds.filter((id) => memberById.has(id)) : [];
  } catch (error) {
    return [];
  }
}

function saveStoredSelection() {
  try {
    window.localStorage.setItem(
      selectionStorageKey,
      JSON.stringify([...selectedCast].filter((id) => memberById.has(id))),
    );
  } catch (error) {
    // Selection still works for the current page when storage is unavailable.
  }
}

function setMemberSelected(memberId, isSelected) {
  if (!memberById.has(memberId)) return;
  if (isSelected) selectedCast.add(memberId);
  else selectedCast.delete(memberId);
  saveStoredSelection();
}

function getSelectedMembers() {
  return selectableCategories.flatMap((category) =>
    getMembersByCategory(category.key).filter((member) => selectedCast.has(member.id)),
  );
}

function groupSelectedMembers(selectedMembers) {
  return selectableCategories
    .map((category) => ({
      ...category,
      members: selectedMembers.filter((member) => member.category === category.key),
    }))
    .filter((group) => group.members.length);
}

function getSelectionSummary(groups, selectedCount) {
  if (!selectedCount) {
    return "اختر كاست واحد أو أكثر من أي قسم، وتبقى اختياراتك محفوظة أثناء التنقل بين الصفحات.";
  }
  const groupText = groups.map((group) => `${group.label} (${group.members.length})`).join("، ");
  const sectionText = groups.length === 1 ? "قسم واحد" : groups.length === 2 ? "قسمين" : `${groups.length} أقسام`;
  return `تم اختيار ${selectedCount} من ${sectionText}: ${groupText}`;
}

function buildWhatsAppHref(selectedMembers) {
  if (!selectedMembers.length) return `https://wa.me/${whatsappNumber}`;
  const messageLines = ["السلام عليكم، أرغب بطلب الملفات التالية:", ""];
  groupSelectedMembers(selectedMembers).forEach((group, groupIndex, groups) => {
    messageLines.push(`${group.label}:`);
    group.members.forEach((member) => messageLines.push(`- ${member.name}`));
    if (groupIndex < groups.length - 1) messageLines.push("");
  });
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(messageLines.join("\n"))}`;
}

function syncRenderedSelections() {
  document.querySelectorAll(".cast-card").forEach((card) => {
    const isSelected = selectedCast.has(card.dataset.castId);
    const checkbox = card.querySelector('input[type="checkbox"]');
    card.classList.toggle("is-selected", isSelected);
    if (checkbox) checkbox.checked = isSelected;
  });
}

function getDisplayValue(value, emptyValue = missingValue) {
  return value && String(value).trim() ? value : emptyValue;
}

function hasCompleteDetails(member) {
  const category = categoryByKey.get(member.category);
  if (category?.profileType === "simple") {
    return ["name", "folderUrl", "photoUrl"].every((key) => String(member[key] || "").trim());
  }
  const requiredKeys = ["boys", "girls"].includes(member.category)
    ? ["age", "height", "weight", "nationality"]
    : ["age", "height", "weight", "nationality", "speaking"];
  return requiredKeys.every((key) => String(member[key] || "").trim());
}

function getCompletionOrder(member, originalIndex) {
  return hasNumericOrder(member.completedOrder)
    ? Number(member.completedOrder)
    : Number.MAX_SAFE_INTEGER + originalIndex;
}

function getPinnedOrder(member) {
  return hasNumericOrder(member.pinnedOrder) ? Number(member.pinnedOrder) : Number.MAX_SAFE_INTEGER;
}

function getAlwaysFirstOrder(member) {
  if (member.category === "women" && member.id === "walaa") return 1;
  if (member.category === "women" && member.id === "lara") return 2;
  if (member.category === "women" && member.id === "raghd") return 3;
  return Number.MAX_SAFE_INTEGER;
}

function getAlwaysLastOrder(member) {
  return member.category === "women" && member.id === "modhi-abdullah" ? 1 : 0;
}

function getMembersByCategory(categoryKey) {
  const indexedMembers = castMembers
    .map((member, index) => ({ member, index }))
    .filter(({ member }) => member.category === categoryKey);
  const usesManualOrder = indexedMembers.some(({ member }) => hasNumericOrder(member.displayOrder));

  return indexedMembers
    .sort((first, second) => {
      if (usesManualOrder) {
        const firstOrder = hasNumericOrder(first.member.displayOrder)
          ? Number(first.member.displayOrder)
          : Number.MAX_SAFE_INTEGER + first.index;
        const secondOrder = hasNumericOrder(second.member.displayOrder)
          ? Number(second.member.displayOrder)
          : Number.MAX_SAFE_INTEGER + second.index;
        return firstOrder - secondOrder || first.index - second.index;
      }

      const firstAlways = getAlwaysFirstOrder(first.member);
      const secondAlways = getAlwaysFirstOrder(second.member);
      if (firstAlways !== secondAlways) return firstAlways - secondAlways;

      const lastDifference = getAlwaysLastOrder(first.member) - getAlwaysLastOrder(second.member);
      if (lastDifference) return lastDifference;

      const firstComplete = hasCompleteDetails(first.member);
      const secondComplete = hasCompleteDetails(second.member);
      if (firstComplete !== secondComplete) return firstComplete ? -1 : 1;

      const pinnedDifference = getPinnedOrder(first.member) - getPinnedOrder(second.member);
      if (pinnedDifference) return pinnedDifference;

      if (firstComplete && secondComplete) {
        return getCompletionOrder(first.member, first.index) - getCompletionOrder(second.member, second.index)
          || first.index - second.index;
      }
      return first.index - second.index;
    })
    .map(({ member }) => member);
}

function getDisplayPhotoUrl(photoUrl) {
  if (!photoUrl) return "";
  try {
    const url = new URL(photoUrl);
    const driveId = url.searchParams.get("id");
    if (url.hostname === "drive.google.com" && driveId) {
      return `https://lh3.googleusercontent.com/d/${driveId}=w1000`;
    }
  } catch (error) {
    return photoUrl;
  }
  return photoUrl;
}

function createInfoItem(label, value, emptyValue = missingValue) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = getDisplayValue(value, emptyValue);
  wrapper.append(term, detail);
  return wrapper;
}

function createMedia(member) {
  const mediaLink = document.createElement("a");
  mediaLink.className = "cast-card__media";
  mediaLink.href = member.folderUrl;
  mediaLink.target = "_blank";
  mediaLink.rel = "noreferrer";
  mediaLink.setAttribute("aria-label", `فتح ملف ${member.name} في Google Drive`);

  if (member.photoUrl) {
    const image = document.createElement("img");
    image.src = getDisplayPhotoUrl(member.photoUrl);
    image.alt = `صورة ${member.name}`;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      const fallback = document.createElement("div");
      fallback.className = "cast-card__fallback";
      fallback.textContent = member.name;
      mediaLink.replaceChildren(fallback);
    });
    mediaLink.appendChild(image);
    return mediaLink;
  }

  const fallback = document.createElement("div");
  fallback.className = "cast-card__fallback";
  fallback.textContent = member.name;
  mediaLink.appendChild(fallback);
  return mediaLink;
}

function createCastCard(member) {
  const categoryDefinition = categoryByKey.get(member.category);
  const simpleProfile = categoryDefinition?.profileType === "simple";
  const card = document.createElement("article");
  card.className = `cast-card${simpleProfile ? " cast-card--simple" : ""}`;
  card.dataset.castId = member.id;
  applyCategoryTheme(card, categoryDefinition);

  const media = createMedia(member);
  const body = document.createElement("div");
  body.className = "cast-card__body";
  const header = document.createElement("div");
  header.className = "cast-card__header";
  const title = document.createElement("h3");
  title.textContent = member.name;
  const badge = document.createElement("span");
  badge.className = "cast-card__category";
  badge.textContent = categoryLabels[member.category] || "ملف";
  header.append(title, badge);

  const workLink = document.createElement("a");
  workLink.className = "cast-card__work-link";
  workLink.href = member.folderUrl;
  workLink.target = "_blank";
  workLink.rel = "noreferrer";
  workLink.textContent = "اضغط لرؤية الأعمال";

  const selectLabel = document.createElement("label");
  selectLabel.className = "cast-select";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.value = member.id;
  checkbox.checked = selectedCast.has(member.id);
  card.classList.toggle("is-selected", checkbox.checked);
  checkbox.addEventListener("change", () => {
    setMemberSelected(member.id, checkbox.checked);
    syncRenderedSelections();
    updateRequestSummary();
  });
  const selectText = document.createElement("span");
  selectText.textContent = simpleProfile ? "اختيار الملف" : "اختيار الكاست";
  selectLabel.append(checkbox, selectText);

  body.append(header, workLink);
  if (!simpleProfile) {
    const infoList = document.createElement("dl");
    infoList.className = "cast-card__info";
    infoList.append(
      createInfoItem("العمر", member.age),
      createInfoItem("الطول", member.height),
      createInfoItem("الوزن", member.weight),
      createInfoItem("الجنسية", member.nationality),
      createInfoItem("متحدث/غير متحدث", member.speaking),
      createInfoItem("ملاحظة", member.note, ""),
    );
    body.append(infoList);
  }
  body.append(selectLabel);
  card.append(media, body);
  return card;
}

function renderSiteNavigation() {
  const nav = document.querySelector(".site-header nav");
  if (!nav) return;
  const requestedKeys = getRequestedCategoryKeys();
  nav.replaceChildren(...categoryDefinitions.map((category) => {
    const link = document.createElement("a");
    link.href = category.href;
    link.textContent = category.label;
    link.classList.toggle("current-page", requestedKeys.includes(category.key));
    return link;
  }));
}

function applyActiveCategory() {
  const activeCategory = categoryByKey.get(getRequestedCategoryKeys()[0]);
  if (!activeCategory) return;
  applyCategoryTheme(document.body, activeCategory);
  document.title = `${activeCategory.label} | الكاست والمصورين`;

  const hero = document.querySelector(".cast-category-hero");
  const heading = hero?.querySelector("h1");
  const eyebrow = hero?.querySelector(".eyebrow");
  const lead = hero?.querySelector(".lead");
  if (heading) heading.textContent = activeCategory.label;
  if (eyebrow) eyebrow.textContent = activeCategory.profileType === "simple" ? "ملفات الأعمال" : "قسم الكاست";
  if (lead) {
    lead.textContent = activeCategory.profileType === "simple"
      ? `افتح ملف أي شخص في قسم ${activeCategory.label} لمشاهدة أعماله، ثم أضفه إلى اختياراتك.`
      : `اختر من قسم ${activeCategory.label}، وافتح صورة أي كاست لمشاهدة ملفه الكامل في الدرايف.`;
  }
}

function renderOverview() {
  if (!castOverview) return;
  castOverview.replaceChildren(...categoryDefinitions.map((category) => {
    const item = document.createElement("div");
    const number = document.createElement("strong");
    const label = document.createElement("span");
    number.textContent = getCategoryCount(category);
    label.textContent = category.label;
    item.append(number, label);
    return item;
  }));
}

function renderQuickLinks() {
  if (!castQuickLinks) return;
  castQuickLinks.replaceChildren(...categories.map((category) => {
    const link = document.createElement("a");
    link.href = category.href;
    link.textContent = `${category.label} (${getCategoryCount(category)})`;
    return link;
  }));
}

function renderCategoryCards() {
  if (!castCategoryCards) return;
  castCategoryCards.replaceChildren(...categoryDefinitions.map((category) => {
    const card = document.createElement("a");
    const title = document.createElement("strong");
    card.className = "cast-category-card";
    card.href = category.href;
    card.setAttribute("aria-label", `فتح قسم ${category.label}`);
    title.textContent = category.label;
    applyCategoryTheme(card, category);
    card.append(title);
    return card;
  }));
}

function renderSections() {
  if (!castSections) return;
  const requestedKeys = getRequestedCategoryKeys();
  const visibleCategories = requestedKeys.length
    ? categories.filter((category) => requestedKeys.includes(category.key))
    : categories;

  const sectionNodes = visibleCategories.map((category) => {
    const members = getMembersByCategory(category.key);
    const section = document.createElement("section");
    section.id = category.key;
    section.className = "section cast-section";
    applyCategoryTheme(section, category);

    const heading = document.createElement("div");
    heading.className = "section-heading";
    const titleBlock = document.createElement("div");
    const eyebrow = document.createElement("p");
    const title = document.createElement("h2");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = category.group || category.label;
    title.textContent = category.label;
    titleBlock.append(eyebrow, title);
    const count = document.createElement("span");
    count.className = "cast-count";
    count.textContent = `${members.length} ملف`;
    heading.append(titleBlock, count);

    const grid = document.createElement("div");
    grid.className = "cast-grid";
    if (members.length) members.forEach((member) => grid.appendChild(createCastCard(member)));
    else {
      const empty = document.createElement("p");
      empty.className = "cast-empty";
      empty.textContent = "القسم جاهز لإضافة البروفايلات من لوحة الإدارة.";
      grid.appendChild(empty);
    }
    section.append(heading, grid);
    return section;
  });

  castSections.replaceChildren(...sectionNodes);
  syncRenderedSelections();
}

function createSelectionDock() {
  if (!document.body.classList.contains("cast-page")) return null;
  const dock = document.createElement("aside");
  const main = document.createElement("div");
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  const summary = document.createElement("span");
  const toggle = document.createElement("button");
  const send = document.createElement("a");
  const panel = document.createElement("div");

  dock.className = "cast-selection-dock is-hidden";
  dock.setAttribute("aria-label", "اختيارات الكاست");
  main.className = "cast-selection-dock__main";
  copy.className = "cast-selection-dock__copy";
  title.className = "cast-selection-dock__title";
  summary.className = "cast-selection-dock__summary";
  toggle.className = "cast-selection-dock__toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  send.className = "button primary";
  send.target = "_blank";
  send.rel = "noreferrer";
  panel.className = "cast-selection-panel";

  title.textContent = "اختياراتي";
  summary.textContent = "لم يتم اختيار كاست بعد";
  toggle.textContent = "عرض";
  send.textContent = "إرسال الطلب";
  send.href = `https://wa.me/${whatsappNumber}`;
  toggle.addEventListener("click", () => {
    const isOpen = dock.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.textContent = isOpen ? "إخفاء" : "عرض";
  });
  send.addEventListener("click", (event) => {
    if (!selectedCast.size) event.preventDefault();
  });

  copy.append(title, summary);
  main.append(copy, toggle, send);
  dock.append(main, panel);
  document.body.appendChild(dock);
  return { dock, panel, send, summary, toggle };
}

const selectionDock = createSelectionDock();

function createSelectionGroup(group) {
  const wrapper = document.createElement("div");
  const heading = document.createElement("strong");
  const list = document.createElement("ul");
  wrapper.className = "cast-selection-group";
  heading.textContent = group.label;
  group.members.forEach((member) => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    const remove = document.createElement("button");
    name.textContent = member.name;
    remove.type = "button";
    remove.dataset.removeCast = member.id;
    remove.setAttribute("aria-label", `حذف ${member.name} من الاختيارات`);
    remove.textContent = "حذف";
    item.append(name, remove);
    list.appendChild(item);
  });
  wrapper.append(heading, list);
  return wrapper;
}

function createSectionNav() {
  const nav = document.createElement("nav");
  const label = document.createElement("span");
  nav.className = "cast-selection-nav";
  nav.setAttribute("aria-label", "الانتقال بين أقسام الكاست");
  label.textContent = "أضف من قسم آخر";
  nav.appendChild(label);
  selectableCategories.forEach((category) => {
    const link = document.createElement("a");
    link.href = category.href;
    link.textContent = category.label;
    nav.appendChild(link);
  });
  return nav;
}

function renderSelectionPanel(groups) {
  if (!selectionDock) return;
  const clearButton = document.createElement("button");
  clearButton.className = "cast-selection-clear";
  clearButton.type = "button";
  clearButton.textContent = "مسح الاختيارات";
  clearButton.addEventListener("click", () => {
    selectedCast.clear();
    saveStoredSelection();
    syncRenderedSelections();
    updateRequestSummary();
  });
  selectionDock.panel.replaceChildren(...groups.map(createSelectionGroup), createSectionNav(), clearButton);
  selectionDock.panel.querySelectorAll("[data-remove-cast]").forEach((button) => {
    button.addEventListener("click", () => {
      setMemberSelected(button.dataset.removeCast, false);
      syncRenderedSelections();
      updateRequestSummary();
    });
  });
}

function updateSelectionDock(selectedMembers, groups, whatsappHref) {
  if (!selectionDock) return;
  const hasSelection = selectedMembers.length > 0;
  selectionDock.dock.classList.toggle("is-hidden", !hasSelection);
  document.body.classList.toggle("has-cast-selection", hasSelection);
  selectionDock.summary.textContent = hasSelection
    ? getSelectionSummary(groups, selectedMembers.length)
    : "لم يتم اختيار كاست بعد";
  selectionDock.send.href = whatsappHref;
  selectionDock.send.classList.toggle("is-disabled", !hasSelection);
  selectionDock.send.setAttribute("aria-disabled", String(!hasSelection));
  if (hasSelection) renderSelectionPanel(groups);
  else {
    selectionDock.dock.classList.remove("is-open");
    selectionDock.toggle.setAttribute("aria-expanded", "false");
    selectionDock.toggle.textContent = "عرض";
    selectionDock.panel.replaceChildren();
  }
}

function updateRequestSummary() {
  const selectedMembers = getSelectedMembers();
  const groups = groupSelectedMembers(selectedMembers);
  const whatsappHref = buildWhatsAppHref(selectedMembers);
  updateSelectionDock(selectedMembers, groups, whatsappHref);

  if (selectedSummary) selectedSummary.textContent = getSelectionSummary(groups, selectedMembers.length);
  if (sendCastRequest) {
    sendCastRequest.href = whatsappHref;
    sendCastRequest.classList.toggle("is-disabled", !selectedMembers.length);
    sendCastRequest.setAttribute("aria-disabled", String(!selectedMembers.length));
  }
}

if (sendCastRequest) {
  sendCastRequest.addEventListener("click", (event) => {
    if (!selectedCast.size) event.preventDefault();
  });
}

window.addEventListener("storage", (event) => {
  if (event.key !== selectionStorageKey) return;
  selectedCast.clear();
  loadStoredSelection().forEach((id) => selectedCast.add(id));
  syncRenderedSelections();
  updateRequestSummary();
});

renderSiteNavigation();
applyActiveCategory();
renderOverview();
renderQuickLinks();
renderCategoryCards();
renderSections();
updateRequestSummary();
