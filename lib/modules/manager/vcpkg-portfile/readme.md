Extracts upstream-source references from [vcpkg](https://learn.microsoft.com/vcpkg/) `portfile.cmake` scripts under `ports/<port>/portfile.cmake`. Each `vcpkg_from_github`, `vcpkg_from_gitlab`, `vcpkg_from_bitbucket`, or `vcpkg_from_git` macro call is emitted as a `PackageDependency` wired to the matching tag-based datasource (`github-tags`, `gitlab-tags`, `bitbucket-tags`, `git-refs`).

The `REF` value is captured as `currentValue` and the `SHA512` value as `currentDigest`. `vcpkg_from_sourceforge` calls are emitted with `skipReason: 'unsupported-url'`; SourceForge has no straight tag datasource.

**Artifact recompute is intentionally deferred to a follow-up.** vcpkg requires the `SHA512` of the upstream archive to be recomputed whenever the `REF` changes, which means downloading the tarball at update time. Until that artifact-recompute step is in place, every extracted dependency is flagged with `skipReason: 'unsupported'` so the dep is visible on the Dependency Dashboard without producing un-applicable PRs.

**Limitations:**

- Variable-substituted `REF`s (for example `set(MY_REF v1.2.3)` followed by `REF ${MY_REF}`) are out of scope: macro calls whose body contains `${...}` are skipped.
- The manager parses only the macro call itself; it does not evaluate surrounding CMake control flow.

References:

- https://learn.microsoft.com/vcpkg/maintainers/maintainer-guide
- https://learn.microsoft.com/vcpkg/maintainers/functions/vcpkg_from_github
