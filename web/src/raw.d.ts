/**
 * A file imported as text. The build (scripts/build-web.mjs) and the test
 * runner both turn `import text from './file.md?raw'` into the file's
 * contents, so the guides in docs/ and the sample shipment in web/samples/
 * are bundled without a second copy.
 */
declare module '*.md?raw' {
  const text: string;
  export default text;
}

declare module '*.eml?raw' {
  const text: string;
  export default text;
}

declare module '*.json?raw' {
  const text: string;
  export default text;
}
