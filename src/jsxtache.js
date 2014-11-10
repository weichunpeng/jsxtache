"use strict";

// @TODO REFACTOR! C0DE IZ RUFF.
// @TODO gotta work on dev friendliness + error handling. compiliation failures aren't pretty.
// @TODO fork esprima-fb and add in mustache signifier support so return statements dont have to be string based?
//       esprima master cant handle xml <div></div>, esprima-fb can but cant handle string based {{mustache}} additions

var esprima = require('esprima');
var lodash = require('lodash');
var tokenize = require('mustache').parse;
var reactTools = require('react-tools');
var chalk = require('chalk');

var RGX = {
  TRAILING_COMMA: /^\s*,/,
  JSX_W_STR: /([^\S\n]*)\'\~\~JSX\~\~\'/
};

var MUSTACHE_TAGS = ['{{','}}'];
var JSX_TAGS = ['{','}'];

// for JSX only -- events etc
var JSX_SIGNIFIER = '`';
// for difficult jsx/mustache conversions like CSS classes + html tag attr
// @TODO on second thought, can probably live w one signifier. just backtick/*, and branch out based on identifier name
var JSXTACHE_SIGNIFIER = '*';

var requirePartials = [];

/**
 * traverse esprima / AST syntax tree
 */
function traverse(root) {
  var list = {};

  /**
   *
   */
  function _traverse(node, parent) {
    if (!node || typeof node.type !== 'string') {
      return;
    } else {
      // @TODO this shouldnt be in this function
      if (!!node.key && !!node.value && node.value.type === 'FunctionExpression') {
        if (node.key.name === 'mustache') {
          list.mustache = node.range;
          try {
            list.mustacheReturn = node.value.body.body[0].range;
          } catch (e) {
            list.mustacheReturn = null;
          }
          try {
            list.mustacheReturnBlock = node.value.body.body[0].argument.range;
          } catch (e) {
            list.mustacheReturnBlock = null;
          }
        } else if (node.key.name === 'render') {
          list.render = node.range;
          try {
            list.renderReturn = node.value.body.body[0].range;
          } catch (e) {
            list.renderReturn = null;
          }
          try {
            list.renderReturnBlock = node.value.body.body[0].argument.range;
          } catch (e) {
            list.renderReturnBlock = null;
          }
        }
      }
    }

    for (var prop in node) {
      var child = node[prop];
      if (Array.isArray(child)) {
        for (var i = 0, l = child.length; i < l; i++) {
          _traverse(child[i], node);
        }
      } else {
        _traverse(child, node)
      }
    }
  }

  _traverse(root, null);
  return list;
}

/**
 *
 */
function renderReplace(jsx, jsxRender) {
  return jsx.replace(RGX.JSX_W_STR, jsxRender);
}

/**
 *
 */
function replacePropsAndState(value) {
  return value.replace('this.props.', '').replace('this.state.', '').replace(/\!/g, '');
}

/**
 *
 */
function handleMustacheName(value) {
  return MUSTACHE_TAGS[0] + replacePropsAndState(value) + MUSTACHE_TAGS[1];
}

/**
 *
 */
function handleMustacheUnsafe(value) {
  return MUSTACHE_TAGS[0] + JSX_TAGS[0] + replacePropsAndState(value) + JSX_TAGS[1] + MUSTACHE_TAGS[1];
}

/**
 * mustache scope will fail silently
 * and handles scope in a crazy way. so lets get creative
 * !!el.name ? (el.name) : (!!this.state.name ? (this.state.name) : (!!this.props.name ? (this.props.name) : (null)))
 * @TODO should check each object for truthy rather than just scope
 */
function handleJSXName(value, scope, removePropsState) {
  var safeValue = '', closingParentheses = '';
  var scopeScanner = [];

  if (!!removePropsState) {
    value = replacePropsAndState(value);
  }

  var explicitScope = value.split('.').length > 1;
  if (!!explicitScope) {
    scope = value.split('.');
    value = scope.pop();
    scopeScanner.push(scope.join('.'));
    scope = null;
  }

  scopeScanner.push('this.state', 'this.props');
  if (!!scope) {
    scopeScanner.unshift(scope);
  }

  // console.log('scopeScanner',scopeScanner, scope, value, '\n')

  scopeScanner.forEach(function(scope) {
    safeValue += ('!!(!!' + scope + ' && !!' + scope + '.' + value + ') ? (' + scope + '.' + value + ') : (');
    closingParentheses += ')';
  });

  safeValue += ('null' + closingParentheses);
  return JSX_TAGS[0] + safeValue + JSX_TAGS[1];
}

/**
 *
 */
function isJSXKey(key) {
  return !!key && key.charAt(0) === JSX_SIGNIFIER;
}

/**
 *
 */
function isJSXtacheKey(key) {
  return !!key && key.charAt(0) === JSXTACHE_SIGNIFIER;
}

/**
 *
 */
function adjustIdentifier(identifier, signifier) {
  if (identifier.charAt(0) === signifier) {
    identifier = identifier.slice(1);
  }
  if (identifier.charAt(identifier.length - 1) === signifier) {
    identifier = identifier.substring(0, identifier.length - 1);
  }
  return identifier.replace(/(^\s*|\s*$)/g, '');
}

/**
 *
 */
function handleJSXKey(identifier) {
  identifier = adjustIdentifier(identifier, JSX_SIGNIFIER);
  var expression = '';
  switch (identifier) {
  case 'key':
    expression = identifier + '=' + JSX_TAGS[0] + 'ndx' + JSX_TAGS[1];
    break;
  default:
    expression = identifier;
  }
  return ' ' + expression;
}

/**
 *
 */
function formatJSXtacheExpressionObject(expression, compileForMustache) {
  var str = '';
  for (var prop in expression) {
    if (!!expression.hasOwnProperty(prop)) {
      str += _formatJSXtacheExpressionObject(prop, expression[prop], compileForMustache);
    }
  }
  return str;
}

/**
 * @TODO not sure why i pulled into new func
 */
function _formatJSXtacheExpressionObject(key, value, compileForMustache) {
  var str = '';
  if (!!compileForMustache) {
    if (typeof value === 'boolean') {
      if (!!value) {
        str += (' ' + key);
      }
    } else {
      // @TODO yikes. pretty hacky way to determine truthy on a string
      var inverse = value.split('!').length % 2 === 0;
      // console.log(value)
      var v = replacePropsAndState(value);
      str += (MUSTACHE_TAGS[0] + (!!inverse ? '^' : '#') + v + MUSTACHE_TAGS[1] + ' ' + key + MUSTACHE_TAGS[0] + '/' + v + MUSTACHE_TAGS[1]);
      // console.log(str)
    }
  } else {
    // @TODO handle bool better. !!true not needed obviously
    str += ' + (!!' +  value + ' ? \" ' + key + '\" : \"\")';
  }
  // console.log(str)
  return str;
}

/**
 *
 */
function formatJSXtacheExpression(expression, compileForMustache) {
  var str = '';
  // console.log('origExp: ', expression);
  expression = expression.replace(/^\{/, '').replace(/\}$/, '');
  // @TODO pretty hacky string handling, improve somehow?
  var expressionIsString = !!~['\'', '"'].indexOf(expression.charAt(0));

  // console.log('ISmustache: ',compileForMustache)
  if (!!compileForMustache) {
    if (!!expressionIsString) {
      str = expression.replace(/\"/g, '').replace(/\'/g, '');
    } else {
      var v = replacePropsAndState(expression);
      str = MUSTACHE_TAGS[0] + v + MUSTACHE_TAGS[1];
    }
  } else {
    str = expression;
  }

  // console.log(str)
  return str;
}

/**
 *
 */
function handleJSXtache(baseExpression, compileForMustache) {
  // console.log('base: ',baseExpression)
  baseExpression = adjustIdentifier(baseExpression, JSXTACHE_SIGNIFIER);
  var expressions = baseExpression.split(/\}\s/).map(function(el) {
    // remove whitespace, turn into array, add back in }
    // console.log('el:',el.replace(/^\s*/, '').replace(/\}?$/, '}'))
    return !!el ? el.replace(/^\s*/, '').replace(/\}?$/, '}') : null;
  });
  expressions = lodash.reject(expressions, function (el) {
    return !el;
  });

  var result = '';
  expressions.forEach(function(expression) {
    var parts = expression.split(/\s*=\s*/);
    var identifier = parts[0];

    switch (identifier) {
    case 'class':
    case 'className':
      identifier = !!compileForMustache ? 'class' : 'className';
      break;
    default:
      // as is
    }

    // @TODO do this differently? lets us assign strings or concat object props into strings
    var formatted = '';
    try {
      expression = JSON.parse(parts[1]);
      expression = formatJSXtacheExpressionObject(expression, compileForMustache);
      formatted = !!compileForMustache ? '\"' + expression + '\"' : '{\"\"' + expression + '}';
    } catch (e) {
      // console.log('parts: ',parts)
      expression = parts[1];
      expression = formatJSXtacheExpression(expression, compileForMustache);
      formatted = !!compileForMustache ? '\"' + expression + '\"' : '{' + expression + '}';
    }

    // console.log('expression: ', expression);
    // console.log('identifier: ', identifier);
    // console.log('formatted: ', formatted);

    var space = result === '' ? '' : ' ';
    result += (space + identifier + '=' + formatted);
  });
  return result;
}

/**
 *
 */
function handleJSXUnsafe(value) {
  // @TODO not sure best way of handling {{{raw}}} since react handles in pretty different way.
  return '<span dangerouslySetInnerHTML=' + MUSTACHE_TAGS[0] + '__html: ' + value + MUSTACHE_TAGS[1] + ' />';
}

/**
 *
 */
function handleMustacheBlock(value, children, inverse) {
  value = replacePropsAndState(value);
  var key = !inverse ? '#' : '^';
  var str = MUSTACHE_TAGS[0] + key + value + MUSTACHE_TAGS[1];
  if (!!children && !!lodash.isArray(children)) {
    str = crossCompile(str, null, children).mustache;
  }
  str += MUSTACHE_TAGS[0] + '/' + value + MUSTACHE_TAGS[1];
  return str;
}

/**
 * @TODO improve?
 * this is a bit crazy looking. but mustache blocks do a lot + need to account for arrays, objects, truthy / falsy
 * accomplishes inline in JSX expression {} without needing a var (which would need additional buffer to inject outside of return)
 * or unintentionally rewriting props. also does cross browser isArray / isObject checks without lodash / underscore
 * (since we cant rely on dependencies for code that can be injected anywhere)
 *
 * ends up looking something like this -->
 *
 * {!!this.props.something ? (
 *   v = this.props.something,
 *   toString.call(v) === '[object Object]' ? (v = [v]) : (null),
 *   toString.call(v) === '[object Array]' ? (
 *     v.map(function(el, ndx) {
 *       return <p>{el.name}</p>;
 *     })
 *   ) : (
 *     <p>{name}</p>
 *   )
 * ) : (null)}
 */
function handleJSXBlock(value, children) {
  var str = JSX_TAGS[0] + "!!" + value + " ? (" +
  "  v = " + value + "," +
  "  toString.call(v) === \"[object Object]\" ? (v = [v]) : (null)," +
  "  toString.call(v) === \"[object Array]\" ? (" +
  "    v.map(function(el, ndx) {" +
  "      return (";

  if (!!children && !!lodash.isArray(children)) {
    // console.log('jsxblock child')
    str = crossCompile(null, str, children, 'el', 'ndx', true).jsx;
  }

  str += ");" +
  "    }.bind(this))" +
  "  ) : (";

  if (!!children && !!lodash.isArray(children)) {
    str = crossCompile(null, str, children).jsx;
  }

  str += "  )" +
  ") : (null)" + JSX_TAGS[1];

  // console.log(str, '\n')

  return str;
}

function handleJSXInverse(value, children) {
  var str = JSX_TAGS[0] + "!" + value + " || !!(toString.call(" + value + ") === \"[object Array]\" && " + value + ".length === 0) ? (";
  if (!!children && !!lodash.isArray(children)) {
    str = crossCompile(null, str, children).jsx;
  }
  str += (") : (null)" + JSX_TAGS[1]);
  return str;
}

/**
 *
 */
function transformJSXtache(jsxtache) {
  var mustache = '', jsx = '';
  var tokens = tokenize(jsxtache);

  // console.log(tokens);
  var result = crossCompile(mustache, jsx, tokens);
  return {
    mustache: result.mustache,
    jsx: result.jsx
  }
}

/**
 *
 */
function handleMustachePartial(path) {
  return MUSTACHE_TAGS[0] + '> ' + path + MUSTACHE_TAGS[1];
}

/**
 *
 */
function handleJSXPartial(path) {
  var varName = path.split('/').map(function(part) {
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join('');
  requirePartials.push({ varName: varName, path: path});
  // @TODO need to be able to pass state etc down as well
  return '<' + varName + ' ' + JSX_TAGS[0] +  '...this.props' + JSX_TAGS[1] + ' />';
}

/**
 * @TODO figure out params / options that make the most sense
 * i think (tokens:array, type:string, options:object)
 * @TODO umm why did i take key param and then declare as var
 */
function crossCompile(mustache, jsx, tokens, scope, key, removePropsState) {
  for (var i = 0, l = tokens.length; i < l; i++) {
    var token = tokens[i], key = token[0], val = token[1], children = token[4];

    // console.log('key: ', key)
    // console.log('val: ', val)

    switch (key) {
    case 'text':
      if (!!mustache || mustache === '') {
        mustache += val;
      }
      if (!!jsx || jsx === '') {
        jsx += val;
      }
      break;
    case 'name':
      if (!isJSXKey(val) && (!!mustache || mustache === '')) {
        if (!!isJSXtacheKey(val)) {
          mustache += handleJSXtache(val, true);
        } else {
          mustache += handleMustacheName(val);
        }
      }
      if (!!jsx || jsx === '') {
        if (!!isJSXKey(val)) {
          jsx += handleJSXKey(val);
        } else if (!!isJSXtacheKey(val)) {
          jsx += handleJSXtache(val, false);
        } else {
          jsx += handleJSXName(val, scope, removePropsState);
        }
      }
      break;
    case '&':
      if (!!mustache || mustache === '') {
        mustache += handleMustacheUnsafe(val);
      }
      if (!!jsx || jsx === '') {
        jsx += handleJSXUnsafe(val);
      }
      break;
    case '#':
      if (!!mustache || mustache === '') {
        mustache += handleMustacheBlock(val, children);
      }
      if (!!jsx || jsx === '') {
        jsx += handleJSXBlock(val, children);
      }
      break;
    case '^':
      if (!!mustache || mustache === '') {
        mustache += handleMustacheBlock(val, children, true);
      }
      if (!!jsx || jsx === '') {
        jsx += handleJSXInverse(val, children);
      }
      break;
    case '!':
      // handle comments. well, ignore comments.
      break;
    case '>':
      if (!!mustache || mustache === '') {
        mustache += handleMustachePartial(val);
      }
      if (!!jsx || jsx === '') {
        jsx += handleJSXPartial(val);
      }
    }
  }

  return {
    mustache: mustache,
    jsx: jsx
  }
}

function injectRequires(jsx) {
  requirePartials = lodash.uniq(requirePartials, 'varName');
  var requires = '';
  requirePartials.forEach(function(partial) {
    requires += 'var ' + partial.varName + ' = require(\'' + partial.path + '\');\n';
  });
  // reset requirePartials buffer since global scope
  requirePartials = [];
  return (requires + jsx);
}

/**
 *
 */
function parse(jsx) {
  var ast = esprima.parse(jsx, { range: true });
  return traverse(ast);
}

/**
 * @TODO solidify / confirm logic on what overwrites what. implicit file dependency vs direct inline.
 *       if mustache (.mustache file or mustache method), jsx assumed inline in render (like normal jsx)
 *       if no mustache, jsxtache assumed. .mustache.jsx file or jsxtache inline in render
 *       inline always takes precedence
 * @TODO write tests
 */
function transform(jsx, jsxtache, mustache) {
  if (!jsx) {
    throw chalk.red('Cannot transform that which cannot be transformed.')
  }

  var list = parse(jsx);
  var compiled = {
    mustache: '',
    jsx: '',
    js: ''
  }

  // overwrites file if included inline
  if (!!list.mustacheReturnBlock) {
    mustache = jsx.substring(list.mustacheReturnBlock[0], list.mustacheReturnBlock[1]);
    mustache = eval(mustache);
    jsx = jsx.substring(0, list.mustache[0]) + jsx.substring(list.mustache[1]).replace(RGX.TRAILING_COMMA, '');
    list = parse(jsx);
  }

  if (!!list.renderReturn) {
    var jsxRender;
    if (!!list.renderReturnBlock) {
      jsxRender = jsx.substring(list.renderReturnBlock[0], list.renderReturnBlock[1]);
      jsx = jsx.substring(0, list.renderReturnBlock[0]) + '\'\~\~JSX\~\~\'' + jsx.substring(list.renderReturnBlock[1]);
      jsxRender = eval(jsxRender);
    }

    if (!!mustache && !!list.renderReturnBlock) {
      jsx = renderReplace(jsx, jsxRender);
    } else {
      // is mustache isnt present, we assume jsxtache
      if (!!jsxRender) {
        jsxtache = jsxRender;
      }

      var result = transformJSXtache(jsxtache);

      if (!list.renderReturnBlock) {
        jsx = jsx.substring(0, list.renderReturn[0]) + 'return (\n\'\~\~JSX\~\~\');' + jsx.substring(list.renderReturn[1]);
      }

      jsx = renderReplace(jsx, result.jsx);
      jsx = injectRequires(jsx);
      mustache = result.mustache;
    }
  } else {
    throw chalk.red('JSX must have render method with a return statement.')
  }

  compiled.mustache = mustache;
  compiled.jsx = jsx;
  compiled.js = reactTools.transform(compiled.jsx);
  return compiled;
}

module.exports = transform;