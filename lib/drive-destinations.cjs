const ROOT = '1kyQALMt95YXHjd0wz3d0tbqRyAm3ukYi';
const CATEGORIES = Object.freeze({
  men: '1HDmnn0FPRygHRcDlQ5rxSmXO7Mb8-2Em',
  women: '1KnOz1YcGIcmAE0AYu8TK2ivAM2yx8o9S',
  boys: '17yLXyTsPQdRJLlTXWfFKN8XtTKTdiuQE',
  girls: '1yAKNbIoiNgLX2Sd6xFQxl9waRHwwO2FZ',
  seniorMen: '1T1G7dpLw5NYviMMjqMTeot8G1AkcssMj',
  seniorWomen: '1dwFnfjPSYxVFxMziHa1ZNIlGGeyj9qLc',
});
function isOfficial(plan) {
  return plan.rootId === ROOT && Object.keys(CATEGORIES).every(key => plan.categories[key] === CATEGORIES[key]);
}
module.exports = { ROOT, CATEGORIES, isOfficial };
