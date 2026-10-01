const { parse } = require('acorn');
const rules = require('../cast-registration-rules.js');

function literal(node) {
  if (node.type === 'Literal' && (node.value === null || ['string', 'number', 'boolean'].includes(typeof node.value))) return node.value;
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal'
    && typeof node.argument.value === 'number') return -node.argument.value;
  if (node.type === 'ArrayExpression' && node.elements.every(Boolean)) return node.elements.map(literal);
  if (node.type === 'ObjectExpression') {
    const value = {};
    for (const property of node.properties) {
      if (property.type !== 'Property' || property.computed || property.method || property.kind !== 'init') throw new Error('Catalog is not plain data');
      const key = property.key.type === 'Identifier' ? property.key.name : property.key.value;
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || Object.hasOwn(value, key)) throw new Error('Invalid catalog key');
      value[key] = literal(property.value);
    }
    return value;
  }
  throw new Error('Executable catalog data rejected');
}
function readCatalog(source) {
  const tree = parse(source, { ecmaVersion: 2024 });
  const expression = tree.body.length === 1 && tree.body[0].type === 'ExpressionStatement' && tree.body[0].expression;
  if (!expression || expression.type !== 'AssignmentExpression' || expression.operator !== '='
    || expression.left.type !== 'MemberExpression' || expression.left.computed
    || expression.left.object.name !== 'window' || expression.left.property.name !== 'castMembers'
    || expression.right.type !== 'ArrayExpression') throw new Error('Unexpected catalog structure');
  const members = literal(expression.right);
  if (members.some(member => !member || typeof member !== 'object' || Array.isArray(member) || typeof member.id !== 'string')
    || new Set(members.map(member => member.id)).size !== members.length) throw new Error('Invalid catalog members');
  return { members, start: expression.right.start, end: expression.right.end };
}
function updateCatalog(source, profile) {
  if (Object.keys(profile).some(key => !rules.publicFields.includes(key))
    || !/^registration-[a-f0-9-]{36}$/.test(profile.id || '')
    || !Object.hasOwn(rules.categories, profile.category)) throw new Error('Invalid public projection');
  const parsed = readCatalog(source);
  const members = parsed.members;
  const existing = members.find(member => member.id === profile.id);
  const sameCategory = existing?.category === profile.category;
  if (existing) Object.assign(existing, profile);
  else members.push({ ...profile });
  if (!sameCategory) {
    const category = members.map((member, index) => ({ member, index }))
      .filter(({ member }) => member.category === profile.category && member.id !== profile.id)
      .sort((a, b) => Number(a.member.displayOrder || Number.MAX_SAFE_INTEGER) - Number(b.member.displayOrder || Number.MAX_SAFE_INTEGER) || a.index - b.index)
      .map(({ member }) => member);
    const anchor = profile.category === 'men' ? 'anas-omar' : profile.category === 'women' ? 'walaa' : null;
    const pinned = category.find(member => member.id === anchor);
    const ordered = [...(pinned ? [pinned] : []), members.find(member => member.id === profile.id), ...category.filter(member => member !== pinned)];
    ordered.forEach((member, index) => { member.displayOrder = index + 1; });
  }
  const array = JSON.stringify(members, null, 2).replace(/</g, '\\u003c');
  return source.slice(0, parsed.start) + array + source.slice(parsed.end);
}
module.exports = { readCatalog, updateCatalog };
