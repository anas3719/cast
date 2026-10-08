const config = require('./drive-destinations.json');
const ROOT = config.root;
const CATEGORIES = Object.freeze(config.categories);
const LEGACY_CATEGORIES = Object.freeze(config.legacyCategories);
const FILE_IDS = Object.freeze([ROOT, ...Object.values(CATEGORIES)]);
function validSelection(ids) {
  return Array.isArray(ids) && ids.length === FILE_IDS.length && new Set(ids).size === FILE_IDS.length
    && FILE_IDS.every(id => ids.includes(id));
}
function isOfficial(plan) {
  return plan.rootId === ROOT && Object.keys(CATEGORIES).every(key => plan.categories[key] === CATEGORIES[key]);
}
module.exports = { ROOT, CATEGORIES, LEGACY_CATEGORIES, FILE_IDS, validSelection, isOfficial };
