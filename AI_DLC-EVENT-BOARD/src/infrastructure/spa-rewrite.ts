// C4 (D4): CloudFront Function source for client-side routes. It runs as a
// viewer-request function on the default (web bucket) behavior only.
//
// Rules, in order:
// - /api, /api/*, /banners, /banners/* are returned unchanged (defense in depth:
//   those paths already use their own cache behaviors).
// - A URI whose last path segment contains "." (a file such as /app.js or
//   /config.json) is returned unchanged.
// - Every other URI, including "/", becomes /index.html. The query string lives
//   in request.querystring and is never modified.
//
// The source is plain ES5-compatible JavaScript for the cloudfront-js-2.0
// runtime. Unit tests evaluate this exact string, so the tested code is the
// deployed code.

export const SPA_REWRITE_FUNCTION_NAME = "team32-ceb-spa-rewrite";

export const SPA_REWRITE_FUNCTION_SOURCE = `function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (
    uri === "/api" ||
    uri === "/banners" ||
    uri.indexOf("/api/") === 0 ||
    uri.indexOf("/banners/") === 0
  ) {
    return request;
  }
  var lastSegment = uri.substring(uri.lastIndexOf("/") + 1);
  if (lastSegment.indexOf(".") !== -1) {
    return request;
  }
  request.uri = "/index.html";
  return request;
}
`;
