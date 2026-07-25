const DISCORD_CUSTOM_ID_MAX_LENGTH = 100;
const UUID_LENGTH = 36;

function propertyName(member) {
  if (!member.computed && member.property.type === 'Identifier') return member.property.name;
  if (member.computed && member.property.type === 'Literal') return String(member.property.value);
  return null;
}

function estimateLength(node) {
  if (!node) return null;

  if (node.type === 'Literal') {
    return typeof node.value === 'string' || typeof node.value === 'number'
      ? String(node.value).length
      : null;
  }

  if (node.type === 'TemplateLiteral') {
    let length = node.quasis.reduce((sum, quasi) => sum + quasi.value.cooked.length, 0);
    for (const expression of node.expressions) {
      const expressionLength = estimateLength(expression);
      if (expressionLength === null) return null;
      length += expressionLength;
    }
    return length;
  }

  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = estimateLength(node.left);
    const right = estimateLength(node.right);
    return left === null || right === null ? null : left + right;
  }

  if (node.type === 'ConditionalExpression') {
    const consequent = estimateLength(node.consequent);
    const alternate = estimateLength(node.alternate);
    return consequent === null || alternate === null ? null : Math.max(consequent, alternate);
  }

  if (node.type === 'Identifier') {
    return /(?:Id|ID|_id)$/.test(node.name) ? UUID_LENGTH : null;
  }

  if (node.type === 'MemberExpression') {
    const property = propertyName(node);
    return property && /^(?:id|.*Id|.*ID|.*_id)$/.test(property) ? UUID_LENGTH : null;
  }

  return null;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Reject Discord component custom IDs that can exceed 100 characters.',
    },
    schema: [],
    messages: {
      tooLong:
        'Discord custom ID can be {{length}} characters; the maximum is {{max}}. Shorten the action prefix or encoded fields.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type !== 'MemberExpression' ||
          propertyName(node.callee) !== 'setCustomId'
        ) {
          return;
        }

        const length = estimateLength(node.arguments[0]);
        if (length !== null && length > DISCORD_CUSTOM_ID_MAX_LENGTH) {
          context.report({
            node: node.arguments[0],
            messageId: 'tooLong',
            data: { length, max: DISCORD_CUSTOM_ID_MAX_LENGTH },
          });
        }
      },
    };
  },
};
