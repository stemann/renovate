This datasource returns versions of [Julia](https://julialang.org/) packages from a [Julia registry](https://pkgdocs.julialang.org/v1/registries/).

A Julia registry is a Git repository with a known on-disk layout.
For a package named `<package>` the registry maps that name to a path via `Registry.toml`, and the per-package metadata lives under `<path>/Versions.toml` and `<path>/Package.toml`.

The datasource clones the registry repository to a local cache directory and reads the per-package files from disk.
The cache directory is derived from the registry URL, so each registry is cloned at most once per run.

Custom registries are supported as first-class registries, including private registries managed by [`LocalRegistry.jl`](https://github.com/GunnarFarneback/LocalRegistry.jl) or hosted on Azure DevOps, private GitHub, etc.
Set `registryUrls` to the Git URL of any Julia registry.
The default `registryUrl` is `https://github.com/JuliaRegistries/General`, the canonical public Julia registry.

Each release entry uses the version string from `Versions.toml` and exposes the `git-tree-sha1` as `gitRef`.
The `repo` field from `Package.toml` is exposed as the package `sourceUrl`.
