#!/usr/bin/env node

const translate = require('google-translate-api-x');

const [text, from, to] = process.argv.slice(2);

if (!text || !from || !to) {
  console.error('Usage: node translate.js <text> <from_lang> <to_lang>');
  process.exit(1);
}

translate(text, { from, to })
  .then(result => {
    console.log(result.text);
    process.exit(0);
  })
  .catch(error => {
    console.error(error.message);
    process.exit(1);
  });
