const path = require('node:path');

const INTERACTION_METHODS = new Set([
  'reply',
  'deferReply',
  'editReply',
  'followUp',
  'showModal',
  'update',
  'deferUpdate',
]);

const SDK_READ_METHODS = new Set(['fetch', 'fetchMessage', 'fetchWebhooks']);
const SDK_WRITE_METHODS = new Set([
  'add',
  'createWebhook',
  'delete',
  'deleteMessage',
  'destroy',
  'edit',
  'editMessage',
  'login',
  'remove',
  'reply',
  'send',
  'setArchived',
  'setLocked',
  'setPresence',
  'subscribe',
]);

const VOICE_READ_FUNCTIONS = new Set(['entersState', 'getVoiceConnection']);
const VOICE_WRITE_FUNCTIONS = new Set(['joinVoiceChannel']);

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function matchesAllowlist(relativePath, patterns) {
  return patterns.some((pattern) => {
    const normalizedPattern = normalizePath(pattern).replace(/^\.\//, '');
    if (normalizedPattern.endsWith('/**')) {
      return relativePath.startsWith(normalizedPattern.slice(0, -2));
    }
    if (normalizedPattern.includes('*')) {
      const escaped = normalizedPattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replaceAll('**', '.*')
        .replaceAll('*', '[^/]*');
      return new RegExp(`^${escaped}$`).test(relativePath);
    }
    return relativePath === normalizedPattern;
  });
}

function propertyName(member) {
  if (!member.computed && member.property.type === 'Identifier') return member.property.name;
  if (member.computed && member.property.type === 'Literal') return String(member.property.value);
  return null;
}

function declarationIsDiscord(declaration) {
  const filename = normalizePath(declaration.getSourceFile().fileName);
  return (
    filename.includes('/node_modules/discord.js/') ||
    filename.includes('/node_modules/@discordjs/') ||
    filename.includes('/node_modules/discord-api-types/')
  );
}

function typeMatches(type, predicate, seen = new Set()) {
  if (!type || seen.has(type)) return false;
  seen.add(type);

  const symbols = [type.aliasSymbol, type.getSymbol?.()].filter(Boolean);
  for (const symbol of symbols) {
    if (predicate(symbol)) return true;
  }

  for (const nested of type.types ?? []) {
    if (typeMatches(nested, predicate, seen)) return true;
  }
  for (const argument of type.aliasTypeArguments ?? type.typeArguments ?? []) {
    if (typeMatches(argument, predicate, seen)) return true;
  }
  if (type.target && type.target !== type && typeMatches(type.target, predicate, seen)) return true;

  return false;
}

function symbolIsDiscord(symbol) {
  return (symbol.getDeclarations?.() ?? []).some(declarationIsDiscord);
}

function symbolIsInteraction(symbol) {
  return symbol.getName().includes('Interaction') && symbolIsDiscord(symbol);
}

function symbolIsRest(symbol) {
  return symbol.getName() === 'REST' && symbolIsDiscord(symbol);
}

function createTypeInspector(context) {
  const services = context.sourceCode.parserServices;
  const checker = services?.program?.getTypeChecker();
  const nodeMap = services?.esTreeNodeToTSNodeMap;

  function typeAt(node) {
    if (!checker || !nodeMap) return null;
    const tsNode = nodeMap.get(node);
    return tsNode ? checker.getTypeAtLocation(tsNode) : null;
  }

  return {
    isDiscord(node) {
      return typeMatches(typeAt(node), symbolIsDiscord);
    },
    isInteraction(node) {
      return typeMatches(typeAt(node), symbolIsInteraction);
    },
    isRest(node) {
      return typeMatches(typeAt(node), symbolIsRest);
    },
  };
}

function stringFragments(node, constants, seen = new Set()) {
  if (!node || seen.has(node)) return [];
  seen.add(node);

  if (node.type === 'Literal' && typeof node.value === 'string') return [node.value];
  if (node.type === 'TemplateLiteral') {
    return [
      ...node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw),
      ...node.expressions.flatMap((expression) => stringFragments(expression, constants, seen)),
    ];
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return [
      ...stringFragments(node.left, constants, seen),
      ...stringFragments(node.right, constants, seen),
    ];
  }
  if (node.type === 'Identifier') return constants.get(node.name) ?? [];
  return [];
}

function isDiscordUrlArgument(node, constants, discordUrlVariables) {
  if (stringFragments(node, constants).some((value) => value.includes('discord.com/api'))) {
    return true;
  }
  if (node?.type === 'Identifier') return discordUrlVariables.has(node.name);
  if (node?.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return false;
  return (
    propertyName(node.callee) === 'toString' &&
    node.callee.object.type === 'Identifier' &&
    discordUrlVariables.has(node.callee.object.name)
  );
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Inventory direct Discord boundary operations',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowlist: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      boundary:
        'Discord boundary call family={{family}} method={{method}} status=unmigrated; route through src/discord.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const allowlist = options.allowlist ?? [];
    const cwd = context.cwd ?? process.cwd();
    const filename = context.filename ?? context.getFilename();
    const relativePath = normalizePath(path.relative(cwd, filename));

    if (matchesAllowlist(relativePath, allowlist)) return {};

    const inspector = createTypeInspector(context);
    const constants = new Map();
    const restConstructors = new Set();
    const restRoutes = new Set();
    const restInstances = new Set();
    const discordUrlVariables = new Set();
    const voiceFunctions = new Map();

    function report(node, family, method) {
      context.report({ node, messageId: 'boundary', data: { family, method } });
    }

    return {
      ImportDeclaration(node) {
        const source = String(node.source.value);
        if (
          source !== 'discord.js' &&
          source !== '@discordjs/rest' &&
          source !== '@discordjs/voice'
        ) {
          return;
        }

        for (const specifier of node.specifiers) {
          if (specifier.type !== 'ImportSpecifier') continue;
          const imported = specifier.imported.name ?? specifier.imported.value;
          if (imported === 'REST') restConstructors.add(specifier.local.name);
          if (imported === 'Routes') restRoutes.add(specifier.local.name);
          if (source === '@discordjs/voice') voiceFunctions.set(specifier.local.name, imported);
        }
      },

      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier' || !node.init) return;

        const fragments = stringFragments(node.init, constants);
        if (fragments.length > 0) constants.set(node.id.name, fragments);

        if (
          node.init.type === 'NewExpression' &&
          node.init.callee.type === 'Identifier' &&
          restConstructors.has(node.init.callee.name)
        ) {
          restInstances.add(node.id.name);
        }

        if (
          node.init.type === 'NewExpression' &&
          node.init.callee.type === 'Identifier' &&
          node.init.callee.name === 'URL' &&
          stringFragments(node.init.arguments[0], constants).some((value) =>
            value.includes('discord.com/api'),
          )
        ) {
          discordUrlVariables.add(node.id.name);
        }
      },

      NewExpression(node) {
        if (node.callee.type === 'Identifier' && restConstructors.has(node.callee.name)) {
          report(node, 'rest', 'constructor');
        }
      },

      CallExpression(node) {
        if (node.callee.type === 'Identifier') {
          const importedVoiceFunction = voiceFunctions.get(node.callee.name);
          if (VOICE_READ_FUNCTIONS.has(importedVoiceFunction)) {
            report(node, 'sdk-read', importedVoiceFunction);
            return;
          }
          if (VOICE_WRITE_FUNCTIONS.has(importedVoiceFunction)) {
            report(node, 'sdk-write', importedVoiceFunction);
            return;
          }

          if (
            node.callee.name === 'fetch' &&
            isDiscordUrlArgument(node.arguments[0], constants, discordUrlVariables)
          ) {
            report(node, 'raw-http', 'fetch');
          }
          return;
        }

        if (node.callee.type !== 'MemberExpression') return;
        const method = propertyName(node.callee);
        if (!method) return;
        const receiver = node.callee.object;

        if (receiver.type === 'Identifier' && restRoutes.has(receiver.name)) {
          report(node, 'rest', method);
          return;
        }

        if (
          (receiver.type === 'Identifier' && restInstances.has(receiver.name)) ||
          (inspector.isRest(receiver) &&
            ['get', 'post', 'put', 'patch', 'delete', 'setToken'].includes(method))
        ) {
          report(node, 'rest', method);
          return;
        }

        if (INTERACTION_METHODS.has(method) && inspector.isInteraction(receiver)) {
          report(node, 'interaction', method);
          return;
        }

        if (!inspector.isDiscord(receiver)) return;
        if (SDK_READ_METHODS.has(method)) {
          report(node, 'sdk-read', method);
        } else if (SDK_WRITE_METHODS.has(method)) {
          report(node, 'sdk-write', method);
        }
      },
    };
  },
};
