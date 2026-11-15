/**
 * Steam's store portrait covers (`library_600x900.jpg`) don't exist for every
 * app. Given a Steam portrait cover URL, derive fallback URLs (header art,
 * then the wide capsule) so <img> onError chains can degrade gracefully
 * instead of showing a broken image.
 */
const STEAM_PORTRAIT_RE =
  /^https?:\/\/[^/]+\/(?:store_item_assets\/)?steam\/apps\/(\d+)\/library_600x900(?:_2x)?\.jpg$/i;

export function steamCoverFallbacks(
  url: string | null | undefined,
): string[] {
  if (!url) return [];
  const m = url.match(STEAM_PORTRAIT_RE);
  if (!m) return [];
  const appId = m[1];
  return [
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_231x87.jpg`,
  ];
}
