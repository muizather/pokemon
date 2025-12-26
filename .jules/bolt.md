## 2024-05-23 - Deep Cloning & Thundering Herd
**Learning:** `JSON.parse(JSON.stringify(obj))` is a common but inefficient anti-pattern for deep cloning in Node.js. With Node 17+, `structuredClone()` is ~5x faster and should be the default for POJO deep copying.
**Learning:** Concurrent async requests for the same resource (cache miss) can lead to a "Thundering Herd" where multiple identical network requests are fired. Using a promise map to deduplicate pending requests (Request Coalescing) completely solves this.
**Action:** Always check for redundant deep cloning in hot paths and prefer `structuredClone`. Implement promise-based request coalescing for expensive async operations that might be called concurrently.
