# "Check the price" URL patterns: HTTP checks (Oct 26 2026, about 12:50 PT)

Query used: `2015 Honda Civic engine air filter`. Every check is a plain GET of the store's own public page. No scraping of results, no APIs, no affiliate tags.

| Store | Pattern | From the box (datacenter IP), Chrome via Playwright | From a home PC (residential IP), curl | Decision |
|---|---|---|---|---|
| AutoZone | `https://www.autozone.com/searchresult?searchText=<q>` | 403 bot wall | 403; the homepage and a made-up path also return 403, so the whole site blocks scripts | Kept: it's the store's public search pattern, but it was NOT verified to reach results (bot wall) |
| O'Reilly | `https://www.oreillyauto.com/search?q=<q>` | 403 "Access Denied" (Akamai) | 403; the homepage also returns 403 | Kept, NOT verified (bot wall) |
| Advance Auto Parts | `https://shop.advanceautoparts.com/web/SearchResults?searchTerm=<q>` | timeout | 200 | Kept (verified 200) |
| Advance Auto Parts | `https://shop.advanceautoparts.com/find/<q>` | 404 "Page not found" | n/a | DROPPED (broken) |
| NAPA | `https://www.napaonline.com/en/search?text=<q>` | 403 "Just a moment..." (challenge) | 403 (the homepage returns 200) | Kept, NOT verified (bot challenge on search) |
| RockAuto | `https://www.rockauto.com/en/catalog/<make>,<year>,<model>` | 200 "2015 HONDA CIVIC \| Shop Now at RockAuto" | 200 | Kept (verified). RockAuto has no keyword-search URL, so this opens the vehicle's catalog |

A 403 from a bot wall is not a broken link: the same URL opened in a phone browser normally passes the check. Still, three of the five are inferred, not verified. Check them once on a phone before the demo.
