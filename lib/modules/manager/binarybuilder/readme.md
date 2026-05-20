Extracts upstream sources from [BinaryBuilder.jl](https://github.com/JuliaPackaging/BinaryBuilder.jl) `build_tarballs.jl` recipes. The largest public collection is [JuliaPackaging/Yggdrasil](https://github.com/JuliaPackaging/Yggdrasil), but the manager has no Yggdrasil-specific assumptions and works against any tree of recipes (private build trees, vendor extensions, scratch directories).

The manager recognises three source constructors used by the recipe DSL:

- `ArchiveSource(url, hash)` and `FileSource(url, hash)` are classified by URL host and path:
  - GitHub release-download URLs (`github.com/<owner>/<repo>/releases/download/<tag>/...`) map to the `github-releases` datasource.
  - GitHub auto-archive URLs (`github.com/<owner>/<repo>/archive/refs/tags/<tag>.<ext>`) map to `github-tags`.
  - GitLab archive URLs (`<host>/<group>/<repo>/-/archive/<tag>/<filename>`) map to `gitlab-tags`. Any GitLab instance is supported (gitlab.com, gitlab.gnome.org, gitlab.freedesktop.org, self-hosted) because the `/-/archive/` path is fixed across instances.
  - GitLab release-download URLs (`<host>/<group>/<repo>/-/releases/<tag>/downloads/...`) map to `gitlab-releases`.
  - Codeberg archive URLs (`codeberg.org/<owner>/<repo>/archive/<tag>.<ext>`) map to `forgejo-tags`.
  - Gitea archive URLs (`gitea.com/<owner>/<repo>/archive/<tag>.<ext>`) map to `gitea-tags`. Self-hosted Gitea on a `gitea.<domain>` hostname is auto-detected.
  - Forgejo archive URLs (any `forgejo.<domain>` hostname) map to `forgejo-tags`.
  - Bitbucket archive URLs (`bitbucket.org/<owner>/<repo>/get/<tag>.<ext>`) map to `bitbucket-tags`.
  - Other URLs are emitted with `skipReason: 'unsupported-url'`. They surface on the Dependency Dashboard so they are visible, but no update PRs are produced.
- `GitSource(url, commit_sha)` is auto-detected for the public forges:
  - `github.com/<owner>/<repo>.git` → `github-tags`.
  - `gitlab.com/<path>.git` → `gitlab-tags`.
  - `codeberg.org/<path>.git` → `forgejo-tags`.
  - `gitea.com/<path>.git` and `gitea.<domain>/<path>.git` (self-hosted Gitea) → `gitea-tags`.
  - `forgejo.<domain>/<path>.git` (self-hosted Forgejo) → `forgejo-tags`.
  - `bitbucket.org/<path>.git` → `bitbucket-tags`.
  - `dev.azure.com/<org>/<project>/_git/<repo>` and the legacy `<org>.visualstudio.com/<project>/_git/<repo>` (with or without `.git`) → `azure-tags`.
  - Any other `http(s)://<host>/<path>.git` URL maps to the generic `git-tags` datasource, which discovers tags via `git ls-remote`. Tags don't move, so this does not produce per-commit update noise.
  - URLs without a `.git` suffix and not matching a known forge get `skipReason: 'unsupported-url'`.
  - SSH-style URLs (`git@<host>:<path>` or `ssh://git@<host>/<path>`) are normalised to the equivalent `https://...` URL and then classified by the rules above. SSH URLs are rare in practice (the BinaryBuilder sandbox has no SSH keys configured), but recognised for completeness.
  - Azure DevOps SSH URLs have a separate shape — `ssh.dev.azure.com:v3/<org>/<project>/<repo>` (modern) and `vs-ssh.visualstudio.com:v3/<org>/<project>/<repo>` (legacy) — and are mapped directly to `azure-tags` rather than going through generic SSH normalisation, since the SSH and HTTPS forms differ in both host and path.
- `DirectorySource(path)` is local and is not extracted.

The hash field accepts any of the four MultiHash-compatible hex lengths: SHA1 (40 chars), SHA256 (64 chars), SHA384 (96 chars), or SHA512 (128 chars) for `ArchiveSource` and `FileSource`. `GitSource` is fixed at the 40-character SHA1 commit. The algorithm is inferred from the hex length when a future change adds hash recompute.

Each extracted dependency carries `currentValue` (the tag or version literal recovered from the URL) and `currentDigest` (the recorded hash). The hash recompute required to actually apply an update is deferred to a follow-up change; until then deps are marked with `skipReason` so they surface on the Dependency Dashboard without producing un-applicable PRs.

The recipe `version = v"X.Y.Z"` literal is captured as `packageFileVersion` for informational purposes only and is not rewritten when sources change.

Some `build_tarballs.jl` recipes load their sources indirectly via `include("../common.jl")` and a `versions_dict` lookup (the pattern is common for upstream projects with multiple version branches). Static regex extraction cannot follow that indirection, so those recipes yield zero dependencies and remain candidates for a future evaluator-backed extractor.

## Customisation with `packageRules`

Recipes vary in how they want to be tracked. Use `packageRules` to override the manager's defaults per recipe or per source URL. Common adjustments:

**Pin a recipe to a specific upstream series** (e.g. OpenSSL 1.1 while the recipe carries `v"1.1.23"` for upstream `1.1.1w`):

```json
{
  "packageRules": [
    {
      "matchManagers": ["binarybuilder"],
      "matchPackageNames": ["openssl/openssl"],
      "allowedVersions": "/^OpenSSL_1_1_/"
    }
  ]
}
```

**Group co-versioned sources into a single PR** (a recipe that bundles a tool plus an SDK, or sources that must move in lockstep). `matchFileNames` paths follow your build tree's layout — the example below uses the Yggdrasil one-letter convention (`C/CMake/...`):

```json
{
  "packageRules": [
    {
      "matchManagers": ["binarybuilder"],
      "matchFileNames": ["C/CMake/**"],
      "groupName": "CMake recipe sources"
    }
  ]
}
```

**Remap a self-hosted forge that the hostname convention doesn't catch.** GitLab `.git` URLs are auto-mapped only on `gitlab.com`; Gitea on `gitea.<domain>`; Forgejo on `forgejo.<domain>`. A forge hosted under any other hostname (e.g. `git.example.com`, `code.example.com`) goes through the generic `git-tags` datasource. Override the datasource and tell it which API to query — the same pattern works for GitLab, Gitea, Forgejo, or Bitbucket Server:

```json
{
  "packageRules": [
    {
      "matchManagers": ["binarybuilder"],
      "matchPackageNames": ["https://gitlab.example.com/foo/bar.git"],
      "datasource": "gitlab-tags",
      "packageName": "foo/bar",
      "registryUrls": ["https://gitlab.example.com"]
    }
  ]
}
```

The original `packageName` (the full git URL) is what `git-tags` uses, so `matchPackageNames` targets it precisely; the override replaces both the datasource and the packageName form that the GitLab API expects.

**Disable updates for a recipe that should stay manual** (e.g. one with a vendored, audit-pinned upstream):

```json
{
  "packageRules": [
    {
      "matchManagers": ["binarybuilder"],
      "matchFileNames": ["O/OpenSSL/**"],
      "enabled": false
    }
  ]
}
```
