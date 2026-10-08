---
'@vocdoni/react-components': minor
---

`ComponentsProvider` takes a `resolveMediaUrl?: MediaUrlResolver` (`(url: string) => string | undefined`) that every election media URL goes through before rendering: the `ElectionHeader` image, choice images and thumbnails in the extended choice presentation, and result choice images. It receives the URL as the election metadata carries it and returns the URL to render (e.g. a `blob:` URL of bytes the app verified), or `undefined` while the media is not ready, in which case slots get `pending` / `image.pending` / `imagePending` and the default slots render a `[data-media-pending]` placeholder. Defaults to the identity. `useResolveMediaUrl()` exposes the current resolver to custom components.
