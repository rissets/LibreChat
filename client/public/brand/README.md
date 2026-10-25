# BP Batam AI assets

Source of truth: the supplied `brand_identity_bp_batam/` kit dated 25 October 2026.
`logo.png` is a byte-for-byte copy of its official PNG. `logo.svg` and `logo-light-v2.svg` embed that unmodified transparent image.
`logo-dark-v2.svg` preserves the symbol and gold subtitle while using light ink for the
main wordmark. Both have no backing rectangle; versioned URLs avoid the former cached icon. Icons contain the entire logo, proportionally scaled on white; nothing is
cropped or recolored. The complete wordmark is intentionally retained even at favicon sizes.

`logo-symbol-v1.svg` exposes the source emblem for the collapsed chat sidebar.
The expanded sidebar uses the full wordmark at 128 × 32 px; the emblem uses 32 × 32 px.
The authentication illustration is specific to the chat client at
`LibreChat/client/public/brand/auth-maritime-v1.webp`; its exact generation prompt
and source PNG are retained in `output/imagegen/`. It is illustrative, not a documentary photo.

Fonts are self-hosted, with their SIL Open Font License notices in `fonts/`:
- Plus Jakarta Sans: Google Fonts / tokotype, https://github.com/google/fonts/tree/main/ofl/plusjakartasans
- JetBrains Mono: Google Fonts / JetBrains, https://github.com/google/fonts/tree/main/ofl/jetbrainsmono
- Inter: existing upstream font assets and license, https://rsms.me/inter/

Official logo source: https://bpbatam.go.id/profile/logo/.
Contact source, checked 25 October 2026: https://bpbatam.go.id/profile/.
UI colors and typography are the kit's independent draft recommendation, not an assertion
of official institutional approval. No newsletter addresses are collected by this installation.

Run `python3 scripts/sync-branding.py` after changing these shared assets, then rebuild the
four UI services. Run `python3 scripts/check-branding.py` against the running stack.
