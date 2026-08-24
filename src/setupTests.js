// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// React Router 7's bundled runtime references TextEncoder/TextDecoder at
// module scope. Browsers and modern Node provide them, but jest 27's jsdom
// environment does not — polyfill from Node's util module so the router
// (and therefore the app) can load under jest.
if (typeof globalThis.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}
