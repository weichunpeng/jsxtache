var transform = require('./../index');
var fs = require('fs');

var React = require('react');
var mustache = require('mustache');

/**
 * helper to test render
 */
function render(result, data) {
  var m = mustache.render(result.mustache, data);
  var Component = React.createFactory(eval(result.js));
  var component = Component(data);
  var r = React.renderToStaticMarkup(component);
  return {
    mustache: m,
    react: r
  }
}

var mainJSX = fs.readFileSync('./components/main.jsx', 'utf-8');
var mainMUSTACHE = fs.readFileSync('./components/main.mustache', 'utf-8');

console.log(mainJSX, mainMUSTACHE);

// var result = transform(code);
// console.log(result);
// var rendered = render(result, { something: 'goodbye', hello: true })

// console.log('\n\n')
// console.log(rendered)