# Release process

## One-time repository setup

1. Create or select the GitHub repository.
2. Push the local `main` branch.
3. Open **Settings > Pages**.
4. Set the source to **GitHub Actions**.
5. Confirm that the `CI` and `Deploy GitHub Pages` workflows pass.
6. Add the resulting Pages URL to the repository description.

## Publish v0.1.0-alpha.1

1. Run:

   ```sh
   npm ci
   npm run verify
   ```

2. Confirm the version in `package.json`, `public/index.html`,
   `CHANGELOG.md` and the release notes.
3. Perform the hardware checklist in `docs/TESTING.md`.
4. Commit the verified source.
5. Create annotated tag `v0.1.0-alpha.1`.
6. Push the branch and tag.
7. Create a GitHub release from the tag, select **Set as a pre-release**, and
   use `docs/RELEASE_NOTES_v0.1.0-alpha.1.md` as the release body.
8. Verify the public Pages build in Chrome or Edge.

GitHub automatically provides source `.zip` and `.tar.gz` archives for the
tag. No generated binary is required for this web alpha.
