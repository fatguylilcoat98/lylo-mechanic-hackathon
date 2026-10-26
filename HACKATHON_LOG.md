
## 2026-10-26 Muse Detective
- Model: `muse-spark-1.3` (standard, not contributor mode). Endpoint: `api.meta.ai/v1/chat/completions` with a strict json_schema, reasoning_effort low, store false.
- Key: `META_MODEL_API_KEY` in `hackathon/server/.env` on the Dell (gitignored, chmod 600). It is not in the PM2 env. Other settings: `LYLO_HACK_MUSE=1`, `LYLO_HACK_MUSE_MODEL`.
- Live calls: 5 total, roughly $0.052 estimated. That covers 1 probe, 3 evidence runs, and 1 post-deploy smoke test, with 0 429s. Pricing used: $1.25/M input, $4.25/M output.
- Results: every scenario was `agreed` with 0 unverified claims. Muse flags the recently-cleared codes (permanent P0171 still present) as a buyer red flag.
- Baseline bug: the shared `what_could_be_wrong` list grew on each request. It is patched from the hackathon layer and covered by a test.
